import fs from "node:fs";
import path from "node:path";

import { parsePersonName, StateStore, stripLegalSuffixes } from "@pm/core";
import { FetchArtifactMeta, NormalizedContribution } from "../core/types";

const LDA_API_BASE_URL = "https://lda.senate.gov/api/v1";
const META_FILENAME = "lda.meta.json";
const CURSOR_FILENAME = "lda.json";
const DEFAULT_LOOKBACK_DAYS = 90;
const PAGE_SIZE = 25;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface LdaCursor {
  lastContributionPostedAt: string;
}

interface LdaFetchOptions {
  asOfDate?: Date;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  allowAnonymousFullFetch?: boolean;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

interface PageLoadResult<T> {
  rows: T[];
  pagesFetched: number;
  requestCount: number;
}

type LdaHeaders = Record<string, string>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeIsoDate(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString().slice(0, 10);
}

function normalizeIsoDateTime(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString();
}

function subtractDays(value: string, days: number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(Date.now() - days * ONE_DAY_MS).toISOString();
  }
  return new Date(parsed.getTime() - days * ONE_DAY_MS).toISOString();
}

function buildLobbyistName(source: Record<string, unknown>): string {
  return [
    String(source.first_name || "").trim(),
    String(source.nickname || "").trim(),
    String(source.middle_name || "").trim(),
    String(source.last_name || "").trim(),
    String(source.suffix_display || source.suffix || "").trim(),
  ].filter(Boolean).join(" ");
}

function buildHeaders(apiKey: string): LdaHeaders {
  return apiKey ? { Authorization: `Token ${apiKey}` } : {};
}

function writeLdaRows(stateStore: StateStore, rows: NormalizedContribution[]): void {
  fs.writeFileSync(path.join(stateStore.paths.recent, "lda.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

async function fetchPage<T>(
  url: string,
  headers: LdaHeaders,
  fetchImpl: typeof fetch,
  maxRetries = 4,
): Promise<PaginatedResponse<T>> {
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt += 1;
    const response = await fetchImpl(url, { headers });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") || "5");
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LDA request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    return await response.json() as PaginatedResponse<T>;
  }

  throw new Error(`LDA request exceeded retry budget: ${url}`);
}

async function fetchAllPages<T>(
  initialUrl: string,
  headers: LdaHeaders,
  fetchImpl: typeof fetch,
): Promise<PageLoadResult<T>> {
  const rows: T[] = [];
  let pagesFetched = 0;
  let requestCount = 0;
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    requestCount += 1;
    const payload: PaginatedResponse<T> = await fetchPage<T>(nextUrl, headers, fetchImpl);
    rows.push(...payload.results);
    pagesFetched += 1;
    nextUrl = payload.next ? new URL(payload.next, initialUrl).toString() : null;
  }

  return { rows, pagesFetched, requestCount };
}

function readPriorLdaRows(stateStore: StateStore): NormalizedContribution[] {
  const filePath = path.join(stateStore.paths.recent, "lda.json");
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as NormalizedContribution[];
}

function readLdaCursor(stateStore: StateStore): LdaCursor | null {
  const filePath = path.join(stateStore.paths.cursors, CURSOR_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as LdaCursor;
}

function writeLdaCursor(stateStore: StateStore, cursor: LdaCursor): void {
  fs.writeFileSync(path.join(stateStore.paths.cursors, CURSOR_FILENAME), `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
}

function writeLdaMetadata(stateStore: StateStore, metadata: FetchArtifactMeta): void {
  fs.writeFileSync(path.join(stateStore.paths.recent, META_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function summarizeRows(rows: NormalizedContribution[]): { contributionRows: number; registrationRows: number } {
  return {
    contributionRows: rows.filter((row) => row.signalType === "contribution").length,
    registrationRows: rows.filter((row) => row.signalType === "registration").length,
  };
}

export function normalizeLdaContributionReport(report: Record<string, unknown>): NormalizedContribution[] {
  const filingUuid = String(report.filing_uuid || "");
  const filingYear = Number(report.filing_year || 0);
  const postedAt = normalizeIsoDateTime(String(report.dt_posted || ""));
  const filingType = String(report.filing_type || "");
  const filingPeriod = String(report.filing_period || "");
  const filerType = String(report.filer_type || "");
  const reportUrl = String(report.filing_document_url || report.url || "");
  const registrant = asRecord(report.registrant);
  const registrantId = Number(registrant.id || 0);
  const registrantName = String(registrant.name || "").trim();
  const lobbyist = asRecord(report.lobbyist);
  const lobbyistId = Number(lobbyist.id || 0);
  const lobbyistNameRaw = buildLobbyistName(lobbyist);
  const fallbackLobbyist = lobbyistNameRaw ? parsePersonName(lobbyistNameRaw) : null;
  const city = String(report.city || registrant.city || "").trim();
  const state = String(report.state || registrant.state || "").trim();
  const zip = String(report.zip || registrant.zip || "").trim();
  const items = Array.isArray(report.contribution_items) ? report.contribution_items : [];

  const rows: NormalizedContribution[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = asRecord(items[index]);
    const contributorName = String(item.contributor_name || "").trim();
    let donorNameRaw = contributorName;
    let parsedName = contributorName ? parsePersonName(contributorName) : null;
    let identitySource = "contributor";

    if (!parsedName) {
      parsedName = fallbackLobbyist;
      donorNameRaw = lobbyistNameRaw;
      identitySource = "lobbyist";
    }

    if (!parsedName) continue;

    const payeeName = String(item.payee_name || "").trim();
    const honoreeName = String(item.honoree_name || "").trim();
    const amount = Number(item.amount || 0);
    const transactionId = `${filingUuid}:${index}`;
    const contributionType = String(item.contribution_type_display || item.contribution_type || "LD-203").trim();

    rows.push({
      source: "Lobbying",
      signalType: "contribution",
      sourceRecordId: transactionId,
      sourceCycle: filingYear ? String(filingYear) : "",
      sourceEntityType: filerType || "lobbyist",
      donorNameRaw,
      donorNameNormalized: parsedName.normalized,
      donorNameNormalizedFull: parsedName.normalizedFull,
      firstName: parsedName.firstName,
      middleName: parsedName.middleName,
      middleInitial: parsedName.middleInitial,
      lastName: parsedName.lastName,
      suffix: parsedName.suffix,
      employerRaw: registrantName,
      employerNormalized: stripLegalSuffixes(registrantName),
      occupationRaw: "LOBBYIST",
      city,
      state,
      zip,
      donationDate: normalizeIsoDate(String(item.date || "")),
      loadDate: postedAt,
      amount,
      currency: "USD",
      transactionType: contributionType,
      memoFlag: false,
      refundFlag: amount < 0,
      amendmentFlag: false,
      recipientId: payeeName,
      recipientName: payeeName,
      recipientType: contributionType ? `LD-203 ${contributionType}` : "LD-203",
      committeeId: "",
      candidateId: "",
      party: "",
      office: "",
      officeState: "",
      officeDistrict: "",
      rawRef: reportUrl,
      metadata: {
        transactionId,
        filingUuid,
        filingType,
        filingYear,
        filingPeriod: filingPeriod || null,
        filerType: filerType || null,
        postedAt: postedAt || null,
        registrantId: registrantId || null,
        lobbyistId: lobbyistId || null,
        honoreeName: honoreeName || null,
        identitySource,
      },
    });
  }

  return rows;
}

export function normalizeLdaLobbyistRegistration(
  lobbyistRecord: Record<string, unknown>,
  fetchedAt: string,
): NormalizedContribution | null {
  const lobbyistId = Number(lobbyistRecord.id || 0);
  const registrant = asRecord(lobbyistRecord.registrant);
  const registrantId = Number(registrant.id || 0);
  const registrantName = String(registrant.name || "").trim();
  const donorNameRaw = buildLobbyistName(lobbyistRecord);
  const parsedName = donorNameRaw ? parsePersonName(donorNameRaw) : null;
  if (!parsedName) return null;

  return {
    source: "Lobbying",
    signalType: "registration",
    sourceRecordId: `registration:${lobbyistId}:${registrantId}`,
    sourceCycle: fetchedAt.slice(0, 4),
    sourceEntityType: "lobbyist_registration",
    donorNameRaw,
    donorNameNormalized: parsedName.normalized,
    donorNameNormalizedFull: parsedName.normalizedFull,
    firstName: parsedName.firstName,
    middleName: parsedName.middleName,
    middleInitial: parsedName.middleInitial,
    lastName: parsedName.lastName,
    suffix: parsedName.suffix,
    employerRaw: registrantName,
    employerNormalized: stripLegalSuffixes(registrantName),
    occupationRaw: "LOBBYIST",
    city: String(registrant.city || "").trim(),
    state: String(registrant.state || "").trim(),
    zip: String(registrant.zip || "").trim(),
    donationDate: "",
    loadDate: fetchedAt,
    amount: 0,
    currency: "USD",
    transactionType: "REGISTRATION",
    memoFlag: false,
    refundFlag: false,
    amendmentFlag: false,
    recipientId: registrantId ? String(registrantId) : "",
    recipientName: registrantName,
    recipientType: "Lobbying Firm",
    committeeId: "",
    candidateId: "",
    party: "",
    office: "",
    officeState: "",
    officeDistrict: "",
    rawRef: String(registrant.url || ""),
    metadata: {
      lobbyistId: lobbyistId || null,
      registrantId: registrantId || null,
      snapshotAt: fetchedAt || null,
    },
  };
}

export async function fetchLdaContributions(
  apiKey: string,
  stateStore: StateStore,
  options: LdaFetchOptions = {},
): Promise<NormalizedContribution[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const asOfDate = options.asOfDate ?? new Date();
  const apiBaseUrl = (options.apiBaseUrl ?? LDA_API_BASE_URL).replace(/\/+$/, "");
  const previousRows = readPriorLdaRows(stateStore);

  if (!apiKey && !options.allowAnonymousFullFetch) {
    const summary = summarizeRows(previousRows);
    writeLdaMetadata(stateStore, {
      source: "Lobbying",
      status: previousRows.length > 0 ? "partial" : "failed",
      fetchedAt: asOfDate.toISOString(),
      recordsFetched: previousRows.length,
      pagesFetched: 0,
      requestCount: 0,
      error: "LDA_API_KEY missing; skipped lobbying refresh. Run will use existing staged lobbying data only.",
      mode: "staged_only_no_refresh",
      authenticated: false,
      contributionRows: summary.contributionRows,
      registrationRows: summary.registrationRows,
    });
    return previousRows;
  }

  const headers = buildHeaders(apiKey);
  const previousContributionRows = previousRows.filter(
    (row) => row.source === "Lobbying" && row.signalType === "contribution",
  );
  const previousRegistrationRows = previousRows.filter(
    (row) => row.source === "Lobbying" && row.signalType === "registration",
  );
  const previousContributionIds = new Set(previousContributionRows.map((row) => row.sourceRecordId));
  const cursor = readLdaCursor(stateStore);
  const overlapStart = cursor?.lastContributionPostedAt
    ? subtractDays(cursor.lastContributionPostedAt, 1)
    : new Date(asOfDate.getTime() - DEFAULT_LOOKBACK_DAYS * ONE_DAY_MS).toISOString();

  let contributionRows: NormalizedContribution[] = [];
  let registrationRows: NormalizedContribution[] = [];
  let contributionsSucceeded = false;
  let registrationsSucceeded = false;
  let contributionPages = 0;
  let registrationPages = 0;
  let requestCount = 0;
  let maxPostedAt = cursor?.lastContributionPostedAt || "";
  const errors: string[] = [];

  try {
    const contributionUrl = new URL(`${apiBaseUrl}/contributions/`);
    contributionUrl.searchParams.set("page_size", String(PAGE_SIZE));
    contributionUrl.searchParams.set("filing_dt_posted_after", overlapStart);
    contributionUrl.searchParams.set("contribution_amount_min", "1");

    const contributionPayload = await fetchAllPages<Record<string, unknown>>(contributionUrl.toString(), headers, fetchImpl);
    requestCount += contributionPayload.requestCount;
    contributionPages = contributionPayload.pagesFetched;
    const deduped = new Map<string, NormalizedContribution>();

    for (const report of contributionPayload.rows) {
      const postedAt = normalizeIsoDateTime(String(asRecord(report).dt_posted || ""));
      if (postedAt && (!maxPostedAt || postedAt > maxPostedAt)) {
        maxPostedAt = postedAt;
      }
      for (const row of normalizeLdaContributionReport(asRecord(report))) {
        if (previousContributionIds.has(row.sourceRecordId)) continue;
        deduped.set(row.sourceRecordId, row);
      }
    }

    contributionRows = Array.from(deduped.values());
    contributionsSucceeded = true;
  } catch (error) {
    errors.push(`Contribution fetch failed: ${String(error)}`);
    contributionRows = previousContributionRows;
  }

  try {
    const lobbyistUrl = new URL(`${apiBaseUrl}/lobbyists/`);
    lobbyistUrl.searchParams.set("page_size", String(PAGE_SIZE));

    const lobbyistPayload = await fetchAllPages<Record<string, unknown>>(lobbyistUrl.toString(), headers, fetchImpl);
    requestCount += lobbyistPayload.requestCount;
    registrationPages = lobbyistPayload.pagesFetched;
    const snapshotAt = asOfDate.toISOString();
    const deduped = new Map<string, NormalizedContribution>();

    for (const lobbyist of lobbyistPayload.rows) {
      const row = normalizeLdaLobbyistRegistration(asRecord(lobbyist), snapshotAt);
      if (row) deduped.set(row.sourceRecordId, row);
    }

    registrationRows = Array.from(deduped.values());
    registrationsSucceeded = true;
  } catch (error) {
    errors.push(`Lobbyist snapshot failed: ${String(error)}`);
    registrationRows = previousRegistrationRows;
  }

  if (contributionsSucceeded && maxPostedAt) {
    writeLdaCursor(stateStore, { lastContributionPostedAt: maxPostedAt });
  }

  const rows = [...contributionRows, ...registrationRows];
  writeLdaRows(stateStore, rows);

  const status: FetchArtifactMeta["status"] = contributionsSucceeded && registrationsSucceeded
    ? "complete"
    : (contributionsSucceeded || registrationsSucceeded ? "partial" : "failed");
  writeLdaMetadata(stateStore, {
    source: "Lobbying",
    status,
    fetchedAt: asOfDate.toISOString(),
    recordsFetched: rows.length,
    pagesFetched: contributionPages + registrationPages,
    requestCount,
    error: errors.length > 0 ? errors.join(" | ") : undefined,
    mode: "posted_overlap_1d",
    authenticated: Boolean(apiKey),
    contributionRows: contributionRows.length,
    registrationRows: registrationRows.length,
  });

  return rows;
}
