import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { FetchArtifactMeta, NormalizedContribution } from "../core/types";
import { stripLegalSuffixes, parseFecName, StateStore } from "@pm/core";

export interface FecApiFetchOptions {
  apiKey: string;
  minDate: string;
  maxDate?: string;
  minAmount?: number;
  twoYearPeriod?: string;
  stateStore: StateStore;
  maxPages?: number;
}

const RATE_LIMIT_PER_HOUR = 1000;
const MS_PER_REQUEST = Math.ceil((60 * 60 * 1000) / RATE_LIMIT_PER_HOUR);
const META_FILENAME = "fec-api.meta.json";

function normalizeRecord(record: Record<string, unknown>): NormalizedContribution | null {
  const donorNameRaw = String(record.contributor_name || "");
  const parsed = parseFecName(donorNameRaw);
  if (!parsed) return null;

  const committee = (record.committee as Record<string, unknown> | undefined) ?? {};
  const amount = Number(record.contribution_receipt_amount || 0);

  return {
    source: "FEC",
    sourceRecordId: String(record.sub_id || record.transaction_id || ""),
    sourceCycle: String(record.two_year_transaction_period || ""),
    sourceEntityType: String(record.entity_type || "IND"),
    donorNameRaw,
    donorNameNormalized: parsed.normalized,
    donorNameNormalizedFull: parsed.normalizedFull,
    firstName: parsed.firstName,
    middleName: parsed.middleName,
    middleInitial: parsed.middleInitial,
    lastName: parsed.lastName,
    suffix: parsed.suffix,
    employerRaw: String(record.contributor_employer || ""),
    employerNormalized: stripLegalSuffixes(String(record.contributor_employer || "")),
    occupationRaw: String(record.contributor_occupation || ""),
    city: String(record.contributor_city || ""),
    state: String(record.contributor_state || ""),
    zip: String(record.contributor_zip || ""),
    donationDate: String(record.contribution_receipt_date || ""),
    loadDate: String(record.load_date || ""),
    amount,
    currency: "USD",
    transactionType: String(record.receipt_type || ""),
    memoFlag: Boolean(record.memo_code),
    refundFlag: amount < 0,
    amendmentFlag: String(record.amendment_indicator || "") === "A",
    recipientId: String(record.committee_id || ""),
    recipientName: String(committee.name || ""),
    recipientType: String(committee.committee_type || ""),
    committeeId: String(record.committee_id || ""),
    candidateId: String(record.candidate_id || ""),
    party: String(committee.party || ""),
    office: String(record.candidate_office || ""),
    officeState: String(record.candidate_office_state || ""),
    officeDistrict: String(record.candidate_office_district || ""),
    rawRef: "",
    metadata: {
      fileNumber: Number(record.file_number || 0),
      transactionId: String(record.transaction_id || ""),
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchRecentFecApi(options: FecApiFetchOptions): Promise<NormalizedContribution[]> {
  if (!options.apiKey) return [];

  const allRows: NormalizedContribution[] = [];
  const maxPages = options.maxPages ?? 2000;
  let page = 0;
  let lastIndex: string | null = null;
  let lastDate: string | null = null;
  let requestCount = 0;
  let lastRequestTime = 0;
  let status: FetchArtifactMeta["status"] = "complete";
  let errorMessage = "";

  while (page < maxPages) {
    const params = new URLSearchParams({
      api_key: options.apiKey,
      min_date: options.minDate,
      two_year_transaction_period: options.twoYearPeriod || "2026",
      is_individual: "true",
      per_page: "100",
      sort_hide_null: "false",
      sort: "contribution_receipt_date",
    });
    if (options.maxDate) params.set("max_date", options.maxDate);
    if (options.minAmount) params.set("min_amount", String(options.minAmount));
    if (lastIndex) params.set("last_index", lastIndex);
    if (lastDate) params.set("last_contribution_receipt_date", lastDate);

    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < MS_PER_REQUEST && requestCount > 0) {
      await sleep(MS_PER_REQUEST - elapsed);
    }

    const url = `https://api.open.fec.gov/v1/schedules/schedule_a/?${params.toString()}`;
    lastRequestTime = Date.now();
    requestCount++;

    let body: string;
    let rateLimitRetries = 0;
    const MAX_RATE_RETRIES = 3;
    while (true) {
      try {
        body = execFileSync("curl", ["-s", "--max-time", "30", url], { encoding: "utf8" });
      } catch {
        status = allRows.length > 0 ? "partial" : "failed";
        errorMessage = "curl request failed";
        process.stderr.write(
          `[ERROR] FEC API curl failed after ${requestCount} requests. ` +
          `Returning ${allRows.length} records fetched so far.\n`,
        );
        body = "";
        break;
      }
      // Check for rate limit (429 comes as an error message in body)
      if (body.includes('"status": 429') && rateLimitRetries < MAX_RATE_RETRIES) {
        rateLimitRetries++;
        const waitSec = 60 * rateLimitRetries;
        process.stderr.write(
          `[WARN] FEC API rate limited (attempt ${rateLimitRetries}/${MAX_RATE_RETRIES}), waiting ${waitSec}s\n`,
        );
        await sleep(waitSec * 1000);
        lastRequestTime = Date.now();
        requestCount++;
        continue;
      }
      break;
    }

    if (!body) break;

    let payload: {
      results?: Array<Record<string, unknown>>;
      pagination?: {
        pages: number;
        count: number;
        last_indexes?: {
          last_index?: string;
          last_contribution_receipt_date?: string;
        };
      };
    };
    try {
      payload = JSON.parse(body);
    } catch {
      status = allRows.length > 0 ? "partial" : "failed";
      errorMessage = "FEC API returned invalid JSON";
      process.stderr.write(
        `[ERROR] FEC API returned invalid JSON after ${requestCount} requests. ` +
        `Returning ${allRows.length} records fetched so far.\n`,
      );
      break;
    }

    if (payload.results === undefined) {
      status = allRows.length > 0 ? "partial" : "failed";
      errorMessage = `FEC API error payload: ${body.slice(0, 200)}`;
      process.stderr.write(
        `[ERROR] FEC API error: ${body.slice(0, 200)}. Returning ${allRows.length} records fetched so far.\n`,
      );
      break;
    }

    const results = payload.results ?? [];
    const rows = results
      .map(normalizeRecord)
      .filter((row): row is NormalizedContribution => row !== null);
    allRows.push(...rows);

    page++;
    process.stderr.write(`[INFO] FEC API page ${page}: ${rows.length} records (${allRows.length} total)\n`);

    const lastIndexes = payload.pagination?.last_indexes;
    if (!lastIndexes?.last_index || results.length === 0) {
      break;
    }
    lastIndex = lastIndexes.last_index;
    lastDate = lastIndexes.last_contribution_receipt_date ?? null;
  }

  if (page >= maxPages) {
    status = "partial";
    errorMessage = `Pagination ceiling hit at ${maxPages} pages`;
    process.stderr.write(
      `[WARN] FEC API pagination hit ceiling (${maxPages} pages, ${allRows.length} records). ` +
      `Results may be incomplete. Consider narrowing the date range or increasing maxPages.\n`,
    );
  }

  const filePath = path.join(options.stateStore.paths.recent, "fec-api.json");
  const metaPath = path.join(options.stateStore.paths.recent, META_FILENAME);
  fs.writeFileSync(filePath, `${JSON.stringify(allRows)}\n`, "utf8");
  const metadata: FetchArtifactMeta = {
    source: "FEC",
    status,
    fetchedAt: new Date().toISOString(),
    recordsFetched: allRows.length,
    pagesFetched: page,
    requestCount,
    error: errorMessage || undefined,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stderr.write(`[INFO] FEC API fetch complete: ${allRows.length} records in ${page} pages (${requestCount} requests)\n`);
  return allRows;
}
