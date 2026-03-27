import fs from "node:fs";
import path from "node:path";

import { computePartisanLean } from "../lib/partisan-lean";
import { buildProspectIndex, loadProspectsDetailed, StateStore } from "@pm/core";
import type { IndexedProspect, Logger, ProspectLoadSummary } from "@pm/core";
import { buildMatchFeatures, NameStats } from "../lib/match-features";
import { scoreMatch } from "../lib/confidence-scorer";
import { routeMatch } from "../lib/review-router";
import { generateMatchTags } from "../lib/match-tags";
import { classifyDonation, classifyProspectAggregate, classifyRegistration } from "../lib/signal-classifier";
import { writeMatchCsv, writeOperatorReport } from "../io/csv-export";
import { createEmptyManifest } from "./run-manifest";
import {
  FetchArtifactMeta,
  MatchResult,
  MatchStats,
  NormalizedContribution,
  ProspectRecord,
  RecipientEnrichment,
  RunManifest,
  SourceFreshness,
} from "./types";
import { loadCandidates } from "../parsers/fec-candidate-parser";
import { loadCommittees } from "../parsers/fec-committee-parser";
import { parseFecIndividualFile, FecParseOptions } from "../parsers/fec-individual-parser";
import { loadLinkages } from "../parsers/fec-ccl-parser";
import { parse527File } from "../parsers/irs527-parser";

interface MatcherOptions {
  runId: string;
  logger: Logger;
  stateStore: StateStore;
  outputDir: string;
  maxProspectSkipRate: number;
}

interface SupplementalSourceConfig {
  source: SourceFreshness["source"];
  filePath: string;
  loader: (filePath: string) => NormalizedContribution[];
  missingDetails: string;
  defaultDetails: string;
  metaPath?: string;
  onMetadata?: (metadata: FetchArtifactMeta, warnings: string[]) => void;
}

export class PoliticalMatcher {
  private readonly runId: string;
  private readonly logger: Logger;
  private readonly stateStore: StateStore;
  private readonly outputDir: string;
  private readonly maxProspectSkipRate: number;

  constructor(options: MatcherOptions) {
    this.runId = options.runId;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.outputDir = options.outputDir;
    this.maxProspectSkipRate = options.maxProspectSkipRate;
  }

  execute(prospectsPath: string): RunManifest {
    const manifest = createEmptyManifest(this.runId, prospectsPath, this.outputDir);
    const { prospects, summary: prospectLoad } = this.loadProspectsOrThrow(prospectsPath);
    manifest.prospectLoad = prospectLoad;
    const { prospectIndex } = buildProspectIndex(prospects);
    const prospectLastNames = new Set(prospects.map((p) => p.lastName.toUpperCase()));
    const { contributions, freshness, warnings } = this.loadCurrentContributions(prospectLastNames);
    const dedupedContributions = this.deduplicateContributions(contributions);
    const enrichment = this.loadEnrichment();
    const stats = this.createStats(warnings);
    const nameStats = this.buildNameStats(dedupedContributions, prospects);

    const candidateMatches = this.matchContributions(dedupedContributions, prospectIndex, nameStats, stats, enrichment);
    const finalizedMatches = this.applyProspectAggregation(candidateMatches);
    const accepted = finalizedMatches.filter((row) => row.guardrailStatus === "pass" && row.matchConfidence >= 70);
    const review = finalizedMatches.filter((row) => !accepted.includes(row));

    accepted.sort(compareResults);
    review.sort(compareResults);

    const runDir = path.join(this.outputDir, this.runId);
    fs.mkdirSync(runDir, { recursive: true });
    const clientCsv = path.join(runDir, "client.csv");
    const reviewCsv = path.join(runDir, "review.csv");
    const runSummaryJson = path.join(runDir, "run_summary.json");
    const statsJson = path.join(runDir, "stats.json");
    const operatorReportMd = path.join(runDir, "operator_report.md");
    const manifestJson = path.join(runDir, "manifest.json");

    writeMatchCsv(clientCsv, accepted);
    writeMatchCsv(reviewCsv, review);

    stats.matchedRows = finalizedMatches.length;
    stats.acceptedRows = accepted.length;
    stats.reviewRows = review.length;
    stats.rejectedRows = stats.candidatePairs - finalizedMatches.length;

    manifest.finishedAt = new Date().toISOString();
    manifest.freshness = freshness;
    manifest.warnings = warnings;
    manifest.counts = stats;
    manifest.degradedSources = freshness.filter((entry) => entry.degraded).map((entry) => entry.source);
    manifest.outputs = {
      clientCsv,
      reviewCsv,
      runSummaryJson,
      statsJson,
      operatorReportMd,
    };

    this.stateStore.writeJson(runSummaryJson, {
      runId: manifest.runId,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      prospectLoad: manifest.prospectLoad,
      degradedSources: manifest.degradedSources,
      counts: manifest.counts,
      warnings: manifest.warnings,
      freshness: manifest.freshness,
    });
    this.stateStore.writeJson(statsJson, stats);
    this.stateStore.writeJson(manifestJson, manifest);
    writeOperatorReport(operatorReportMd, manifest);

    return manifest;
  }

  private createStats(warnings: string[]): MatchStats {
    return {
      totalRecords: 0,
      skippedRecords: 0,
      candidatePairs: 0,
      matchedRows: 0,
      acceptedRows: 0,
      reviewRows: 0,
      rejectedRows: 0,
      matchesBySource: {},
      warnings,
    };
  }

  private loadCurrentContributions(prospectLastNames?: Set<string>): {
    contributions: NormalizedContribution[];
    freshness: SourceFreshness[];
    warnings: string[];
  } {
    const contributions: NormalizedContribution[] = [];
    const freshness: SourceFreshness[] = [];
    const warnings: string[] = [];

    const fecFile = path.join(this.stateStore.paths.recent, "fec-individual.txt");
    if (fs.existsSync(fecFile)) {
      this.logger.info(`Loading FEC contributions from ${fecFile}`);
      const fecSize = fs.statSync(fecFile).size;
      const fecOpts: FecParseOptions = {};
      if (fecSize > 500_000_000) {
        fecOpts.minAmount = 1000;
        fecOpts.minDate = "2025-12-01";
        fecOpts.maxDate = "2026-03-26";
        if (prospectLastNames) fecOpts.lastNameFilter = prospectLastNames;
      }
      const rows = parseFecIndividualFile(fecFile, fecOpts);
      this.logger.info(`Loaded ${rows.length} FEC records${fecOpts.minAmount ? ` (>=$${fecOpts.minAmount})` : ""}`);
      for (const row of rows) contributions.push(row);
      freshness.push({
        source: "FEC",
        fetchedAt: new Date(fs.statSync(fecFile).mtimeMs).toISOString(),
        latestRecordDate: latestDate(rows),
        degraded: false,
        details: "Loaded recent FEC contributions",
      });
    } else {
      warnings.push(`Missing recent FEC file: ${fecFile}`);
      freshness.push({
        source: "FEC",
        fetchedAt: "",
        latestRecordDate: "",
        degraded: true,
        details: "No recent FEC file staged",
      });
    }

    const fecApiJson = path.join(this.stateStore.paths.recent, "fec-api.json");
    if (fs.existsSync(fecApiJson)) {
      const rows = this.readJsonRows(fecApiJson);
      const metaPath = path.join(this.stateStore.paths.recent, "fec-api.meta.json");
      const metadata = this.readFetchMetadata(metaPath);
      const degraded = metadata?.status !== "complete";
      const details = metadata
        ? `Loaded recent OpenFEC API records (${metadata.status}${metadata.mode ? `, ${metadata.mode}` : ""})`
        : "Loaded recent OpenFEC API records (metadata missing)";
      for (const row of rows) contributions.push(row);
      if (!metadata) {
        warnings.push(`Missing FEC API metadata file: ${metaPath}`);
      } else if (metadata.status !== "complete") {
        warnings.push(
          `FEC API fetch was ${metadata.status}; loaded ${metadata.recordsFetched} rows across ${metadata.pagesFetched} pages` +
          `${metadata.error ? ` (${metadata.error})` : ""}`,
        );
      }
      freshness.push({
        source: "FEC",
        fetchedAt: metadata?.fetchedAt || new Date(fs.statSync(fecApiJson).mtimeMs).toISOString(),
        latestRecordDate: latestDate(rows),
        degraded,
        details,
      });
    }

    const supplementalSources: SupplementalSourceConfig[] = [
      {
        source: "527",
        filePath: path.join(this.stateStore.paths.recent, "irs527.json"),
        loader: (filePath) => this.readJsonRows(filePath),
        metaPath: path.join(this.stateStore.paths.recent, "irs527.meta.json"),
        missingDetails: "No staged 527 file",
        defaultDetails: "Loaded recent IRS 527 contributions",
      },
      {
        source: "State",
        filePath: path.join(this.stateStore.paths.recent, "state.json"),
        loader: (filePath) => this.readJsonRows(filePath),
        missingDetails: "State staged data not present",
        defaultDetails: "Loaded State normalized rows",
      },
      {
        source: "Lobbying",
        filePath: path.join(this.stateStore.paths.recent, "lda.json"),
        loader: (filePath) => this.readJsonRows(filePath),
        metaPath: path.join(this.stateStore.paths.recent, "lda.meta.json"),
        missingDetails: "Lobbying staged data not present",
        defaultDetails: "Loaded Lobbying normalized rows",
        onMetadata: (metadata, sourceWarnings) => {
          if (metadata.status !== "complete") {
            sourceWarnings.push(
              `LDA fetch was ${metadata.status}; loaded ${metadata.recordsFetched} rows across ${metadata.pagesFetched} pages` +
              `${metadata.error ? ` (${metadata.error})` : ""}`,
            );
          }
          if (metadata.authenticated === false) {
            sourceWarnings.push("LDA fetch ran without LDA_API_KEY; anonymous rate limits may reduce freshness.");
          }
        },
      },
    ];

    for (const sourceConfig of supplementalSources) {
      this.loadSupplementalSource(sourceConfig, contributions, freshness, warnings);
    }

    const legacy527Path = path.join(this.stateStore.paths.recent, "irs527.txt");
    if (!fs.existsSync(path.join(this.stateStore.paths.recent, "irs527.json")) && fs.existsSync(legacy527Path)) {
      const rows = parse527File(legacy527Path);
      for (const row of rows) contributions.push(row);
      freshness.push({
        source: "527",
        fetchedAt: new Date(fs.statSync(legacy527Path).mtimeMs).toISOString(),
        latestRecordDate: latestDate(rows),
        degraded: false,
        details: "Loaded legacy IRS 527 text export",
      });
    }

    return { contributions, freshness, warnings };
  }

  private loadSupplementalSource(
    config: SupplementalSourceConfig,
    contributions: NormalizedContribution[],
    freshness: SourceFreshness[],
    warnings: string[],
  ): void {
    if (!fs.existsSync(config.filePath)) {
      freshness.push({
        source: config.source,
        fetchedAt: "",
        latestRecordDate: "",
        degraded: true,
        details: config.missingDetails,
      });
      return;
    }

    const rows = config.loader(config.filePath);
    for (const row of rows) contributions.push(row);
    const metadata = config.metaPath ? this.readFetchMetadata(config.metaPath) : null;
    const degraded = metadata?.status ? metadata.status !== "complete" : false;
    const details = metadata
      ? `${config.defaultDetails} (${metadata.status}${metadata.mode ? `, ${metadata.mode}` : ""})`
      : config.defaultDetails;

    if (config.metaPath && !metadata) {
      warnings.push(`Missing ${config.source} metadata file: ${config.metaPath}`);
    }
    if (metadata && config.onMetadata) {
      config.onMetadata(metadata, warnings);
    }

    freshness.push({
      source: config.source,
      fetchedAt: metadata?.fetchedAt || new Date(fs.statSync(config.filePath).mtimeMs).toISOString(),
      latestRecordDate: latestDate(rows),
      degraded,
      details,
    });
  }

  private readJsonRows(filePath: string): NormalizedContribution[] {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as NormalizedContribution[];
  }

  private readFetchMetadata(filePath: string): FetchArtifactMeta | null {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as FetchArtifactMeta;
  }

  private loadProspectsOrThrow(prospectsPath: string): {
    prospects: ProspectRecord[];
    summary: ProspectLoadSummary;
  } {
    const { prospects, summary } = loadProspectsDetailed(prospectsPath);
    if (summary.skippedRows > 0) {
      const preview = summary.failures.slice(0, 10).map((failure) => `row ${failure.row}: "${failure.name}"`).join("; ");
      this.logger.warn(
        `Skipped ${summary.skippedRows}/${summary.totalRows} prospect rows (${(summary.skippedRate * 100).toFixed(2)}%): ${preview}` +
        `${summary.failures.length > 10 ? `; and ${summary.failures.length - 10} more` : ""}`,
      );
    }
    if (summary.skippedRate > this.maxProspectSkipRate) {
      throw new Error(
        `Skipped ${summary.skippedRows}/${summary.totalRows} prospect rows (${(summary.skippedRate * 100).toFixed(2)}%), ` +
        `which exceeds PFUND_MAX_PROSPECT_SKIP_RATE=${this.maxProspectSkipRate}`,
      );
    }
    return { prospects, summary };
  }

  private deduplicateContributions(contributions: NormalizedContribution[]): NormalizedContribution[] {
    const byKey = new Map<string, NormalizedContribution>();
    for (const row of contributions) {
      const rawId = String(row.metadata.transactionId || row.sourceRecordId);
      const transactionId = `${row.source}:${rawId}`;
      const existing = byKey.get(transactionId);
      if (!existing) {
        byKey.set(transactionId, row);
        continue;
      }

      const existingFile = Number(existing.metadata.fileNumber || 0);
      const nextFile = Number(row.metadata.fileNumber || 0);
      if (nextFile >= existingFile) {
        byKey.set(transactionId, row);
      }
    }
    return Array.from(byKey.values());
  }

  private loadEnrichment(): {
    committees: ReturnType<typeof loadCommittees>;
    candidates: ReturnType<typeof loadCandidates>;
    linkages: ReturnType<typeof loadLinkages>;
  } {
    const committeePath = path.join(this.stateStore.paths.lookups, "cm.txt");
    const candidatePath = path.join(this.stateStore.paths.lookups, "cn.txt");
    const linkagePath = path.join(this.stateStore.paths.lookups, "ccl.txt");

    return {
      committees: fs.existsSync(committeePath) ? loadCommittees(committeePath) : new Map(),
      candidates: fs.existsSync(candidatePath) ? loadCandidates(candidatePath) : new Map(),
      linkages: fs.existsSync(linkagePath) ? loadLinkages(linkagePath) : new Map(),
    };
  }

  private buildNameStats(contributions: NormalizedContribution[], prospects: ProspectRecord[]): NameStats {
    const donorNameCounts = new Map<string, number>();
    const prospectNameCounts = new Map<string, number>();

    for (const record of contributions) {
      donorNameCounts.set(record.donorNameNormalized, (donorNameCounts.get(record.donorNameNormalized) ?? 0) + 1);
    }

    for (const prospect of prospects) {
      prospectNameCounts.set(prospect.nameNormalized, (prospectNameCounts.get(prospect.nameNormalized) ?? 0) + 1);
    }

    return { donorNameCounts, prospectNameCounts };
  }

  private resolveRecipient(
    record: NormalizedContribution,
    enrichmentData: ReturnType<PoliticalMatcher["loadEnrichment"]>,
  ): RecipientEnrichment {
    if (record.source !== "FEC") {
      return {
        recipient: record.recipientName || record.recipientId || "Unknown recipient",
        recipientType: record.recipientType || record.source,
        party: record.party || "UNKNOWN",
        candidateName: metadataString(record.metadata.honoreeName),
        candidateOffice: "",
      };
    }

    const committee = enrichmentData.committees.get(record.committeeId);
    const candidateId = committee?.candidateId || enrichmentData.linkages.get(record.committeeId) || "";
    const candidate = candidateId ? enrichmentData.candidates.get(candidateId) : undefined;
    const party = normalizeParty(committee?.committeeParty || candidate?.party || "");
    const office = candidate ? formatOffice(candidate.office, candidate.officeState, candidate.officeDistrict) : "";

    return {
      recipient: committee?.committeeName || record.committeeId || "Unknown committee",
      recipientType: inferRecipientType(committee?.committeeType || ""),
      party,
      candidateName: candidate?.candidateName || "",
      candidateOffice: office,
    };
  }

  private matchContributions(
    contributions: NormalizedContribution[],
    prospectIndex: Map<string, IndexedProspect[]>,
    nameStats: NameStats,
    stats: MatchStats,
    enrichment: ReturnType<PoliticalMatcher["loadEnrichment"]>,
  ): MatchResult[] {
    const rows: MatchResult[] = [];

    for (const record of contributions) {
      stats.totalRecords += 1;
      const candidates = prospectIndex.get(record.donorNameNormalized) ?? [];
      if (candidates.length === 0) {
        stats.skippedRecords += 1;
        continue;
      }

      for (const candidate of candidates) {
        stats.candidatePairs += 1;
        const features = buildMatchFeatures(candidate.prospect, record, candidate.variantType, nameStats);
        const score = scoreMatch(features);
        const route = routeMatch(features, score);

        if (route.bucket === "rejected") {
          continue;
        }

        const recipient = this.resolveRecipient(record, enrichment);
        const classification = record.signalType === "registration"
          ? classifyRegistration(recipient.recipient)
          : classifyDonation(record.amount, recipient.recipient, recipient.recipientType);
        const matchTags = generateMatchTags(features, candidate.prospect, record);
        rows.push({
          runId: this.runId,
          prospectId: candidate.prospect.prospectId,
          prospectName: candidate.prospect.nameRaw,
          prospectCompany: candidate.prospect.companyRaw,
          prospectTitle: candidate.prospect.title,
          prospectCityState: [candidate.prospect.city, candidate.prospect.state].filter(Boolean).join(", "),
          donorNameFec: record.donorNameRaw,
          donorEmployer: record.employerRaw,
          donorOccupation: record.occupationRaw,
          donorCityState: [record.city, record.state].filter(Boolean).join(", "),
          donationAmount: record.amount,
          donationDate: record.donationDate || record.loadDate,
          recipient: recipient.recipient,
          recipientType: recipient.recipientType,
          party: recipient.party,
          candidateName: recipient.candidateName,
          candidateOffice: recipient.candidateOffice,
          dataSource: record.source,
          matchConfidence: score.matchConfidence,
          matchTags,
          partisanLean: "Unknown",
          action: classification.action,
          signalType: record.signalType,
          guardrailStatus: route.guardrailStatus,
          signalTier: classification.tier,
          flags: record.signalType === "registration" ? ["Registered Lobbyist"] : [],
          contribution: {
            ...record,
            recipientName: recipient.recipient,
            recipientType: recipient.recipientType,
            party: recipient.party,
            candidateId: record.candidateId || "",
            office: recipient.candidateOffice,
          },
        });
        stats.matchesBySource[record.source] = (stats.matchesBySource[record.source] ?? 0) + 1;
      }
    }

    return rows;
  }

  private applyProspectAggregation(rows: MatchResult[]): MatchResult[] {
    const byProspect = new Map<string, MatchResult[]>();
    for (const row of rows) {
      const bucket = byProspect.get(row.prospectId) ?? [];
      bucket.push(row);
      byProspect.set(row.prospectId, bucket);
    }

    for (const [, prospectRows] of byProspect) {
      const partisanLean = computePartisanLean(prospectRows);
      const aggregate = classifyProspectAggregate(prospectRows);
      for (const row of prospectRows) {
        row.partisanLean = partisanLean;
        row.signalTier = Math.min(row.signalTier, aggregate.tier);
        row.flags = Array.from(new Set([...row.flags, ...aggregate.flags]));
        row.action = aggregate.action;
      }
    }

    return rows;
  }
}

function metadataString(value: string | number | boolean | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function normalizeParty(party: string): string {
  if (party === "DEM") return "DEM";
  if (party === "REP") return "REP";
  return party || "UNKNOWN";
}

function inferRecipientType(type: string): string {
  switch (type) {
    case "H":
      return "House Campaign";
    case "S":
      return "Senate Campaign";
    case "P":
      return "Presidential Campaign";
    case "O":
      return "Super PAC";
    case "Q":
    case "N":
      return "PAC";
    case "X":
    case "Y":
    case "Z":
      return "Party";
    default:
      return "Political Committee";
  }
}

function formatOffice(office: string, state: string, district: string): string {
  if (!office) return "";
  if (office === "P") return "President";
  if (office === "S") return state ? `Senate - ${state}` : "Senate";
  if (office === "H") return state && district ? `House - ${state}-${district}` : "House";
  return office;
}

function latestDate(rows: NormalizedContribution[]): string {
  return rows
    .map((row) => row.donationDate || row.loadDate)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] ?? "";
}

function compareResults(a: MatchResult, b: MatchResult): number {
  if (a.signalTier !== b.signalTier) return a.signalTier - b.signalTier;
  if (a.matchConfidence !== b.matchConfidence) return b.matchConfidence - a.matchConfidence;
  return b.donationAmount - a.donationAmount;
}
