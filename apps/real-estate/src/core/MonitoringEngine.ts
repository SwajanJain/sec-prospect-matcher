import fs from "node:fs";
import path from "node:path";

import {
  buildProspectIndex,
  createLogger,
  generateNameVariants,
  loadProspectsDetailed,
  StateStore,
} from "@pm/core";
import type { IndexedProspect, Logger, ProspectRecord, VariantType } from "@pm/core";

import { createEmptyManifest } from "./run-manifest";
import type {
  AttomFetchPageResult,
  ChangeType,
  MatchQuality,
  MonitoringManifest,
  MonitoringRunOptions,
  ParsedOwner,
  PriorStateRecord,
  PropertyMatch,
  PropertyRecord,
} from "./types";
import { compareAddresses } from "../lib/address-matcher";
import { buildOwnerFingerprints, classifyPropertyChange } from "../lib/change-classifier";
import { scoreMatch, variantWeight } from "../lib/confidence-scorer";
import { estimateGivingCapacity } from "../lib/capacity-formula";
import { buildMatchFeatures, propertySignalFromChange } from "../lib/match-features";
import { routeMatch } from "../lib/review-router";
import { writeMatchCsv } from "../io/csv-export";
import { normalizeAttomProperty } from "../parsers/source-normalizers";
import { AttomClient } from "../fetchers/attom";
import { CacheStore } from "../fetchers/cache-store";
import { readEnvFile } from "../cli/util";

interface MonitoringEngineDeps {
  attomClient: AttomClient;
  cacheStore: CacheStore;
  logger?: Logger;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10).replace(/-/g, "/");
}

function prospectAddressLike(prospect: ProspectRecord): string | undefined {
  if (!prospect.city && !prospect.state) return undefined;
  return `UNKNOWN, ${prospect.city}, ${prospect.state}`.trim();
}

function propertyAddressLike(property: PropertyRecord): { situs?: string; mailing?: string } {
  const situs = property.situsCity && property.situsState
    ? `UNKNOWN, ${property.situsCity}, ${property.situsState} ${property.situsZip ?? ""}`.trim()
    : property.situsAddress;
  const mailing = property.ownerMailingCity && property.ownerMailingState
    ? `UNKNOWN, ${property.ownerMailingCity}, ${property.ownerMailingState} ${property.ownerMailingZip ?? ""}`.trim()
    : property.ownerMailingAddress;
  return { situs, mailing };
}

function normalizedOwnerKeys(owner: ParsedOwner): Array<{ key: string; variantType: VariantType | "trust_extracted" | "co_owner" }> {
  const results = new Map<string, VariantType | "trust_extracted" | "co_owner">();
  if (owner.normalized) results.set(owner.normalized, owner.extractedFrom === "trust_name" ? "trust_extracted" : owner.extractedFrom === "co_owner" ? "co_owner" : "exact");
  for (const variant of generateNameVariants(owner.raw)) {
    results.set(variant.value, variant.variantType);
  }
  return Array.from(results.entries()).map(([key, variantType]) => ({ key, variantType }));
}

function rarityMap(prospects: ProspectRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const prospect of prospects) {
    const key = `${prospect.firstName} ${prospect.lastName}`.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function nextStartDate(watermark: string | undefined, fallback: string): string {
  if (!watermark) return fallback;
  const date = new Date(`${watermark}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
}

function dedupeMatches(matches: PropertyMatch[]): PropertyMatch[] {
  const bestByKey = new Map<string, PropertyMatch>();
  for (const match of matches) {
    const key = `${match.prospectId}|${match.property.sourcePropertyId}`;
    const existing = bestByKey.get(key);
    if (!existing || existing.combinedScore < match.combinedScore) {
      bestByKey.set(key, match);
    }
  }
  return Array.from(bestByKey.values());
}

function buildPriorState(property: PropertyRecord): PriorStateRecord {
  return {
    sourcePropertyId: property.sourcePropertyId,
    ownerFingerprints: buildOwnerFingerprints(property),
    lastSaleDate: property.lastSaleDate,
    lastSalePrice: property.lastSalePrice,
    mortgageAmount: property.mortgageAmount,
    assessedTotal: property.assessedTotal,
    lastSeen: new Date().toISOString(),
  };
}

function buildSignals(property: PropertyRecord, changeType: ChangeType, matchedCount: number) {
  return [{
    tier: (changeType === "owner_change" ? 1 : 2) as 1 | 2,
    signal: propertySignalFromChange(changeType, property),
    detail: property.situsAddress,
    action: matchedCount > 1 ? "Review portfolio context" : "Review for prospect research",
  }];
}

function qualitySortValue(quality: MatchQuality): number {
  switch (quality) {
    case "high": return 4;
    case "medium": return 3;
    case "low": return 2;
    default: return 1;
  }
}

export class MonitoringEngine {
  private readonly attomClient: AttomClient;
  private readonly cacheStore: CacheStore;
  private readonly logger: Logger;

  constructor(deps: MonitoringEngineDeps) {
    this.attomClient = deps.attomClient;
    this.cacheStore = deps.cacheStore;
    this.logger = deps.logger ?? createLogger(true);
  }

  async execute(options: MonitoringRunOptions): Promise<MonitoringManifest> {
    const manifest = createEmptyManifest(options.runId, "monitor", options.prospectsPath, options.outputDir, options.counties);
    const { prospects, summary } = loadProspectsDetailed(options.prospectsPath);
    manifest.prospectLoad = summary;
    const { prospectIndex } = buildProspectIndex(prospects);
    const nameRarity = rarityMap(prospects);

    const startDateFallback = options.startDate ?? isoDate(new Date());
    const endDate = options.endDate ?? isoDate(new Date());
    const accepted: PropertyMatch[] = [];
    const review: PropertyMatch[] = [];

    const countyErrors: Array<{ county: string; error: string }> = [];

    for (const county of options.counties) {
      try {
      const watermark = this.cacheStore.readWatermark(county);
      const startDate = options.startDate ?? nextStartDate(watermark?.lastCompleted, startDateFallback);
      const firstScanForCounty = !watermark?.lastCompleted;
      this.cacheStore.writeWatermark(county, {
        lastCompleted: watermark?.lastCompleted,
        lastStarted: endDate,
        status: "partial",
      });

      const priorStateWrites: PriorStateRecord[] = [];
      let page = 1;
      let totalPages: number | undefined;
      const matchesForCounty: PropertyMatch[] = [];

      while (true) {
        const pageResult = await this.loadPage(county, startDate, endDate, page);
        manifest.counts.apiCalls += pageResult.fromCache ? 0 : 1;
        manifest.counts.cacheHits += pageResult.fromCache ? 1 : 0;
        if (typeof pageResult.pages === "number") totalPages = pageResult.pages;
        this.cacheStore.markPageComplete(county, startDate, endDate, page, totalPages);

        for (const rawProperty of pageResult.properties) {
          const property = normalizeAttomProperty(rawProperty);
          if (!property.sourcePropertyId) continue;
          manifest.counts.propertyRecordsProcessed += 1;
          manifest.counts.ownersParsed += property.parsedOwners.length;

          const prior = this.cacheStore.readPriorState(property.sourcePropertyId);
          const changeType = classifyPropertyChange(property, prior);
          priorStateWrites.push(buildPriorState(property));

          if (!this.shouldAlert(changeType, firstScanForCounty, options.scanAll ?? false)) continue;
          const propertyMatches = this.matchProperty(property, prospects, prospectIndex, nameRarity, changeType);
          for (const match of propertyMatches) {
            matchesForCounty.push(match);
            manifest.counts.candidateMatches += 1;
            if (match.matchReasons.some((reason) => reason.includes("common_name"))) {
              manifest.counts.commonNameFlags += 1;
            }
          }
        }

        if (pageResult.properties.length < pageResult.pageSize) break;
        if (typeof totalPages === "number" && page >= totalPages) break;
        page += 1;
      }

      this.cacheStore.writePriorStates(priorStateWrites);
      this.cacheStore.writeWatermark(county, {
        lastCompleted: endDate.replace(/\//g, "-"),
        lastStarted: endDate.replace(/\//g, "-"),
        status: "complete",
      });
      manifest.counts.countiesScanned += 1;

      const deduped = dedupeMatches(matchesForCounty);

      // Second pass: count how many distinct properties each prospect matched,
      // then re-score with the real portfolio corroboration count.
      const propertyCountByProspect = new Map<string, number>();
      for (const match of deduped) {
        propertyCountByProspect.set(match.prospectId, (propertyCountByProspect.get(match.prospectId) ?? 0) + 1);
      }
      for (const match of deduped) {
        const count = propertyCountByProspect.get(match.prospectId) ?? 1;
        if (count > 1) {
          // Re-score with real portfolio count
          const prospect = prospects.find((p) => p.prospectId === match.prospectId);
          if (!prospect) continue;
          const addressMatch = compareAddresses(prospectAddressLike(prospect), propertyAddressLike(match.property));
          const rarityKey = `${prospect.firstName} ${prospect.lastName}`.trim().toLowerCase();
          const features = buildMatchFeatures({
            prospect,
            property: match.property,
            variantType: match.matchReasons.find((r) => r.startsWith("name:"))?.slice(5) as VariantType ?? "exact",
            addressMatch,
            candidateCount: nameRarity.get(rarityKey) ?? prospects.length,
            portfolioCorroborationCount: count,
            changeType: match.changeType,
          });
          const rescored = scoreMatch(features);
          match.combinedScore = rescored.combinedScore;
          match.quality = rescored.quality;
          match.matchReasons = rescored.reasons;
        }
      }

      for (const match of deduped.sort((a, b) => qualitySortValue(b.quality) - qualitySortValue(a.quality) || b.combinedScore - a.combinedScore)) {
        if (routeMatch(match.quality) === "client") {
          accepted.push(match);
          manifest.counts.acceptedMatches += 1;
        } else {
          review.push(match);
          manifest.counts.reviewMatches += 1;
        }
      }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`County ${county} failed: ${message}`);
        countyErrors.push({ county, error: message });
        // watermark stays "partial" — will be retried on next run
      }
    }

    if (countyErrors.length > 0) {
      this.logger.warn(`${countyErrors.length} county scan(s) failed: ${countyErrors.map((e) => e.county).join(", ")}`);
    }

    const runDir = path.join(options.outputDir, options.runId);
    fs.mkdirSync(runDir, { recursive: true });
    writeMatchCsv(manifest.outputs.clientCsv, accepted);
    writeMatchCsv(manifest.outputs.reviewCsv, review);
    manifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(manifest.outputs.statsJson, `${JSON.stringify(manifest.counts, null, 2)}\n`, "utf8");
    fs.writeFileSync(manifest.outputs.manifestJson, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  private async loadPage(fips: string, startDate: string, endDate: string, page: number): Promise<AttomFetchPageResult> {
    const cached = this.cacheStore.readPage<AttomFetchPageResult>(fips, startDate, endDate, page);
    if (cached) {
      return { ...cached, fromCache: true };
    }
    const fetched = await this.attomClient.fetchCountyPage({ fips, startDate, endDate, page });
    this.cacheStore.writePage(fips, startDate, endDate, page, fetched);
    return fetched;
  }

  private matchProperty(
    property: PropertyRecord,
    prospects: ProspectRecord[],
    prospectIndex: Map<string, IndexedProspect[]>,
    rarityByName: Map<string, number>,
    changeType: ChangeType,
  ): PropertyMatch[] {
    const matches: PropertyMatch[] = [];
    for (const owner of property.parsedOwners) {
      const candidates = new Map<string, { prospect: ProspectRecord; variantType: VariantType | "trust_extracted" | "co_owner" }>();
      for (const key of normalizedOwnerKeys(owner)) {
        for (const indexed of prospectIndex.get(key.key) ?? []) {
          if (!candidates.has(indexed.prospect.prospectId)) {
            candidates.set(indexed.prospect.prospectId, { prospect: indexed.prospect, variantType: key.variantType });
          }
        }
      }

      for (const candidate of candidates.values()) {
        const addressMatch = compareAddresses(prospectAddressLike(candidate.prospect), propertyAddressLike(property));
        const rarityKey = `${candidate.prospect.firstName} ${candidate.prospect.lastName}`.trim().toLowerCase();
        const features = buildMatchFeatures({
          prospect: candidate.prospect,
          property,
          variantType: candidate.variantType === "trust_extracted" || candidate.variantType === "co_owner" ? "exact" : candidate.variantType,
          addressMatch,
          candidateCount: rarityByName.get(rarityKey) ?? prospects.length,
          portfolioCorroborationCount: 1,
          changeType,
        });
        const scored = scoreMatch(features);
        const capacity = estimateGivingCapacity([{
          value: property.estimatedValue ?? property.assessedTotal ?? 0,
          isOwnerOccupied: property.isOwnerOccupied ?? false,
          mortgageAmount: property.mortgageAmount,
        }]);
        matches.push({
          prospectId: candidate.prospect.prospectId,
          prospectName: candidate.prospect.nameRaw,
          property,
          matchedOwner: owner,
          changeType,
          nameScore: variantWeight(candidate.variantType === "trust_extracted" || candidate.variantType === "co_owner" ? "exact" : candidate.variantType),
          addressScore: addressMatch.confidence,
          combinedScore: scored.combinedScore,
          quality: scored.quality,
          matchReasons: scored.reasons,
          signals: buildSignals(property, changeType, 1),
          estimatedCapacity5yr: capacity.fiveYearCapacity,
        });
      }
    }
    return matches;
  }

  private shouldAlert(changeType: ChangeType, firstScanForCounty: boolean, scanAll: boolean): boolean {
    if (scanAll) return true;
    if (changeType === "owner_change") return true;
    if (changeType === "new_to_cache") return !firstScanForCounty;
    return false;
  }

  static fromEnv(cwd: string, stateDir?: string): MonitoringEngine {
    const envValues = readEnvFile(cwd);
    const apiKeyRaw = process.env.ATTOM_API_KEY || envValues.ATTOM_API_KEY || "";
    const apiKeys = apiKeyRaw.split(",").map((k) => k.trim()).filter(Boolean);
    if (apiKeys.length === 0) throw new Error("Missing ATTOM_API_KEY in environment or .env");
    const root = stateDir || process.env.RESTATE_STATE_DIR || envValues.RESTATE_STATE_DIR || path.join(cwd, ".restate");
    const stateStore = new StateStore(root);
    stateStore.ensure();
    return new MonitoringEngine({
      attomClient: new AttomClient({ apiKeys }),
      cacheStore: new CacheStore(stateStore),
    });
  }
}
