import { XMLParser } from "fast-xml-parser";
import { parsePersonName } from "@pm/core";
import type { FilingHeader, GrantRecord, NonprofitRecord, NonprofitSource, NonprofitSourceSection } from "./types";
import { buildRecordDedupKey, buildRecordFingerprint, classifyTitleBucket, normalizeTitle } from "./match-utils";

const SKIP_NAMES = new Set(["VACANT", "NONE", "N/A", "NA", "NOT APPLICABLE", "TBD", "UNKNOWN"]);
const DATE_ANNOTATION_RE = /\s+AS\s+OF\s+\w+\s+\d{4}\s*$/i;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  isArray: (tagName: string) =>
    [
      "ContributorInformationGrp",
      "OfficerDirTrstKeyEmplGrp",
      "Form990PartVIISectionAGrp",
      "GrantOrContributionPdDurYrGrp",
      "RltdOrgOfficerTrstKeyEmplGrp",
    ].includes(tagName),
});

function safeStr(val: unknown): string {
  if (val == null) return "";
  return String(val).trim();
}

function safeNum(val: unknown): number {
  if (val == null) return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function extractAddress(addr: Record<string, unknown> | undefined): { street: string; city: string; state: string; zip: string } {
  if (!addr) return { street: "", city: "", state: "", zip: "" };
  const line1 = safeStr(addr.AddressLine1Txt);
  const line2 = safeStr(addr.AddressLine2Txt);
  return {
    street: [line1, line2].filter(Boolean).join(" "),
    city: safeStr(addr.CityNm),
    state: safeStr(addr.StateAbbreviationCd),
    zip: safeStr(addr.ZIPCd),
  };
}

function cleanPersonName(raw: string): string {
  return raw.replace(DATE_ANNOTATION_RE, "").trim();
}

function classifyRole(title: string, indicators?: Record<string, unknown>): string {
  const t = title.toUpperCase();
  if (t.includes("TRUSTEE")) return "trustee";
  if (t.includes("DIRECTOR")) return "director";
  if (t.includes("KEY EMPLOYEE") || t.includes("KEY EMP")) return "key_employee";

  if (indicators) {
    if (indicators.IndividualTrusteeOrDirectorInd === "X") return "director";
    if (indicators.HighestCompensatedEmployeeInd === "X") return "key_employee";
    if (indicators.KeyEmployeeInd === "X") return "key_employee";
    if (indicators.OfficerInd === "X") return "officer";
  }

  if (
    t.includes("PRESIDENT") || t.includes("CHAIRMAN") || t.includes("SECRETARY") ||
    t.includes("TREASURER") || t.includes("OFFICER") || t.includes("EXECUTIVE") ||
    t.includes("CEO") || t.includes("CFO") || t.includes("COO")
  ) {
    return "officer";
  }
  return "officer";
}

function parseHeader(ret: Record<string, unknown>, objectId: string): FilingHeader | null {
  const header = ret.ReturnHeader as Record<string, unknown> | undefined;
  if (!header) return null;

  const filer = header.Filer as Record<string, unknown> | undefined;
  if (!filer) return null;

  const bizName = filer.BusinessName as Record<string, unknown> | undefined;
  const addr = filer.USAddress as Record<string, unknown> | undefined;
  const loc = extractAddress(addr);
  const returnType = safeStr(header.ReturnTypeCd);

  return {
    ein: safeStr(filer.EIN),
    orgName: safeStr(bizName?.BusinessNameLine1Txt),
    orgCity: loc.city,
    orgState: loc.state,
    taxPeriodEnd: safeStr(header.TaxPeriodEndDt),
    returnType: returnType === "990PF" ? "990PF" : "990",
    objectId,
  };
}

function tryParsePerson(rawName: string): ReturnType<typeof parsePersonName> {
  const cleaned = cleanPersonName(rawName);
  if (!cleaned || cleaned.length < 3) return null;
  if (SKIP_NAMES.has(cleaned.toUpperCase())) return null;
  if (/\d/.test(cleaned)) return null;
  return parsePersonName(cleaned);
}

function buildRecord(params: {
  source: NonprofitSource;
  sourceSection: NonprofitSourceSection;
  filing: FilingHeader;
  rawName: string;
  title: string;
  role: string;
  amount: number;
  hoursPerWeek: number;
  street: string;
  city: string;
  state: string;
  zip: string;
  personLocationSource: NonprofitRecord["personLocationSource"];
}): NonprofitRecord | null {
  const parsed = tryParsePerson(params.rawName);
  if (!parsed) return null;

  const normalizedTitle = normalizeTitle(params.title);
  return {
    source: params.source,
    sourceSection: params.sourceSection,
    filing: params.filing,
    personName: params.rawName,
    personNameNormalized: parsed.normalized,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    middleName: parsed.middleName,
    suffix: parsed.suffix,
    title: params.title,
    normalizedTitle,
    titleBucket: classifyTitleBucket(params.title, params.role),
    role: params.role,
    amount: params.amount,
    hoursPerWeek: params.hoursPerWeek,
    street: params.street,
    city: params.city,
    state: params.state,
    zip: params.zip,
    personLocationSource: params.personLocationSource,
    recordFingerprint: buildRecordFingerprint(
      params.filing.objectId,
      params.source,
      parsed.normalized,
      normalizedTitle,
      params.amount,
      params.sourceSection,
    ),
    withinFilingDuplicateCount: 1,
  };
}

function collapseDuplicateRecords(records: NonprofitRecord[]): { records: NonprofitRecord[]; duplicateCollapseCount: number } {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = buildRecordDedupKey(
      record.filing.objectId,
      record.source,
      record.personNameNormalized,
      record.normalizedTitle,
      record.amount,
    );
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const deduped = new Map<string, NonprofitRecord>();
  let duplicateCollapseCount = 0;

  for (const record of records) {
    const key = buildRecordDedupKey(
      record.filing.objectId,
      record.source,
      record.personNameNormalized,
      record.normalizedTitle,
      record.amount,
    );
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, { ...record, withinFilingDuplicateCount: counts.get(key) ?? 1 });
      continue;
    }

    duplicateCollapseCount++;
    if (existing.personLocationSource === "unknown" && record.personLocationSource !== "unknown") {
      deduped.set(key, { ...record, withinFilingDuplicateCount: counts.get(key) ?? 1 });
    }
  }

  return { records: [...deduped.values()], duplicateCollapseCount };
}

function parse990PFDonors(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const schedB = data.IRS990ScheduleB as Record<string, unknown> | undefined;
  if (!schedB) return [];

  const contributors = schedB.ContributorInformationGrp as Record<string, unknown>[] | undefined;
  if (!contributors) return [];

  const records: NonprofitRecord[] = [];
  for (const contrib of contributors) {
    if (contrib.ContributorBusinessName) continue;
    if (safeStr(contrib.PersonContributionInd) !== "X") continue;

    const rawName = safeStr(contrib.ContributorPersonNm);
    const addr = extractAddress(contrib.ContributorUSAddress as Record<string, unknown> | undefined);
    const record = buildRecord({
      source: "990-PF-DONOR",
      sourceSection: "schedule_b_contributor",
      filing,
      rawName,
      title: "",
      role: "donor",
      amount: safeNum(contrib.TotalContributionsAmt),
      hoursPerWeek: 0,
      street: addr.street,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      personLocationSource: addr.city || addr.state ? "person_address" : "unknown",
    });
    if (record) records.push(record);
  }
  return records;
}

function parse990PFOfficers(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const pf = data.IRS990PF as Record<string, unknown> | undefined;
  if (!pf) return [];

  const infoGrp = pf.OfficerDirTrstKeyEmplInfoGrp as Record<string, unknown> | undefined;
  if (!infoGrp) return [];

  const officers = infoGrp.OfficerDirTrstKeyEmplGrp as Record<string, unknown>[] | undefined;
  if (!officers) return [];

  const records: NonprofitRecord[] = [];
  for (const officer of officers) {
    const rawName = safeStr(officer.PersonNm);
    const addr = extractAddress(officer.USAddress as Record<string, unknown> | undefined);
    const title = safeStr(officer.TitleTxt);
    const record = buildRecord({
      source: "990-PF-OFFICER",
      sourceSection: "pf_officer_info",
      filing,
      rawName,
      title,
      role: classifyRole(title),
      amount: safeNum(officer.CompensationAmt),
      hoursPerWeek: safeNum(officer.AverageHrsPerWkDevotedToPosRt),
      street: addr.street,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      personLocationSource: addr.city || addr.state ? "person_address" : "unknown",
    });
    if (record) records.push(record);
  }
  return records;
}

function parse990PartVIIOfficers(irs990: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const officers = irs990.Form990PartVIISectionAGrp as Record<string, unknown>[] | undefined;
  if (!officers) return [];

  const records: NonprofitRecord[] = [];
  for (const officer of officers) {
    const rawName = safeStr(officer.PersonNm);
    const title = safeStr(officer.TitleTxt);
    const comp = safeNum(officer.ReportableCompFromOrgAmt) + safeNum(officer.OtherCompensationAmt);
    const record = buildRecord({
      source: "990-OFFICER",
      sourceSection: "part_vii_section_a",
      filing,
      rawName,
      title,
      role: classifyRole(title, officer),
      amount: comp,
      hoursPerWeek: safeNum(officer.AverageHoursPerWeekRt),
      street: "",
      city: "",
      state: "",
      zip: "",
      personLocationSource: "unknown",
    });
    if (record) records.push(record);
  }
  return records;
}

function parse990RelatedOrgOfficers(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const scheduleJ = data.IRS990ScheduleJ as Record<string, unknown> | undefined;
  if (!scheduleJ) return [];

  const related = scheduleJ.RltdOrgOfficerTrstKeyEmplGrp as Record<string, unknown>[] | undefined;
  if (!related) return [];

  const records: NonprofitRecord[] = [];
  for (const officer of related) {
    const rawName = safeStr(officer.PersonNm);
    const title = safeStr(officer.TitleTxt);
    const comp =
      safeNum(officer.BaseCompensationFilingOrgAmt) +
      safeNum(officer.CompensationBasedOnRelatedOrgAmt) +
      safeNum(officer.OtherCompensationAmt);
    const record = buildRecord({
      source: "990-OFFICER",
      sourceSection: "schedule_j_related_org",
      filing,
      rawName,
      title,
      role: classifyRole(title, officer),
      amount: comp,
      hoursPerWeek: 0,
      street: "",
      city: "",
      state: "",
      zip: "",
      personLocationSource: "unknown",
    });
    if (record) records.push(record);
  }
  return records;
}

function parse990Officers(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const irs990 = data.IRS990 as Record<string, unknown> | undefined;
  if (!irs990) return [];
  return [
    ...parse990PartVIIOfficers(irs990, filing),
    ...parse990RelatedOrgOfficers(data, filing),
  ];
}

function parse990PFGrants(data: Record<string, unknown>, filing: FilingHeader): GrantRecord[] {
  const pf = data.IRS990PF as Record<string, unknown> | undefined;
  if (!pf) return [];

  const suppInfo = pf.SupplementaryInformationGrp as Record<string, unknown> | undefined;
  if (!suppInfo) return [];

  const grantGrps = suppInfo.GrantOrContributionPdDurYrGrp as Record<string, unknown>[] | undefined;
  if (!grantGrps) return [];

  const grants: GrantRecord[] = [];
  for (const g of grantGrps) {
    const bizName = g.RecipientBusinessName as Record<string, unknown> | undefined;
    const recipientName = safeStr(bizName?.BusinessNameLine1Txt) || safeStr(g.RecipientPersonNm);
    if (!recipientName) continue;

    const addr = extractAddress(g.RecipientUSAddress as Record<string, unknown> | undefined);
    grants.push({
      filing,
      recipientName,
      recipientCity: addr.city,
      recipientState: addr.state,
      amount: safeNum(g.Amt),
      purpose: safeStr(g.GrantOrContributionPurposeTxt),
    });
  }
  return grants;
}

export function parseIrsXml(xmlContent: string, objectId: string): {
  records: NonprofitRecord[];
  grants: GrantRecord[];
  duplicateCollapseCount: number;
} {
  const parsed = parser.parse(xmlContent);
  const ret = parsed?.Return as Record<string, unknown> | undefined;
  if (!ret) return { records: [], grants: [], duplicateCollapseCount: 0 };

  const filing = parseHeader(ret, objectId);
  if (!filing) return { records: [], grants: [], duplicateCollapseCount: 0 };

  const data = ret.ReturnData as Record<string, unknown> | undefined;
  if (!data) return { records: [], grants: [], duplicateCollapseCount: 0 };

  const rawRecords: NonprofitRecord[] = filing.returnType === "990PF"
    ? [...parse990PFDonors(data, filing), ...parse990PFOfficers(data, filing)]
    : parse990Officers(data, filing);
  const grants = filing.returnType === "990PF" ? parse990PFGrants(data, filing) : [];

  const collapsed = collapseDuplicateRecords(rawRecords);
  return {
    records: collapsed.records,
    grants,
    duplicateCollapseCount: collapsed.duplicateCollapseCount,
  };
}
