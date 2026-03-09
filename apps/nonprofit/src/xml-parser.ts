import { XMLParser } from "fast-xml-parser";
import { parsePersonName } from "@pm/core";
import { FilingHeader, NonprofitRecord, GrantRecord } from "./types";

const SKIP_NAMES = new Set(["VACANT", "NONE", "N/A", "NA", "NOT APPLICABLE", "TBD", "UNKNOWN"]);

// Strip date annotations like "AS OF JUNE 2024" from officer names
const DATE_ANNOTATION_RE = /\s+AS\s+OF\s+\w+\s+\d{4}\s*$/i;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  isArray: (_tagName: string) =>
    [
      "ContributorInformationGrp",
      "OfficerDirTrstKeyEmplGrp",
      "Form990PartVIISectionAGrp",
      "GrantOrContributionPdDurYrGrp",
    ].includes(_tagName),
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

function extractAddress(addr: Record<string, unknown> | undefined): { city: string; state: string } {
  if (!addr) return { city: "", state: "" };
  return {
    city: safeStr(addr.CityNm),
    state: safeStr(addr.StateAbbreviationCd),
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

  // 990 has role indicator flags
  if (indicators) {
    if (indicators.IndividualTrusteeOrDirectorInd === "X") return "director";
    if (indicators.HighestCompensatedEmployeeInd === "X") return "key_employee";
    if (indicators.KeyEmployeeInd === "X") return "key_employee";
    if (indicators.OfficerInd === "X") return "officer";
  }

  if (t.includes("PRESIDENT") || t.includes("CHAIRMAN") || t.includes("SECRETARY") ||
      t.includes("TREASURER") || t.includes("OFFICER") || t.includes("EXECUTIVE") ||
      t.includes("CEO") || t.includes("CFO") || t.includes("COO")) return "officer";
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
  return parsePersonName(cleaned);
}

function parse990PFDonors(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const records: NonprofitRecord[] = [];
  const schedB = data.IRS990ScheduleB as Record<string, unknown> | undefined;
  if (!schedB) return records;

  const contributors = schedB.ContributorInformationGrp as Record<string, unknown>[] | undefined;
  if (!contributors) return records;

  for (const contrib of contributors) {
    // Skip organization donors
    if (contrib.ContributorBusinessName) continue;
    // Must be a person contribution
    if (safeStr(contrib.PersonContributionInd) !== "X") continue;

    const rawName = safeStr(contrib.ContributorPersonNm);
    const parsed = tryParsePerson(rawName);
    if (!parsed) continue;

    const addr = extractAddress(contrib.ContributorUSAddress as Record<string, unknown> | undefined);

    records.push({
      source: "990-PF-DONOR",
      filing,
      personName: rawName,
      personNameNormalized: parsed.normalized,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      middleName: parsed.middleName,
      suffix: parsed.suffix,
      title: "",
      role: "donor",
      amount: safeNum(contrib.TotalContributionsAmt),
      hoursPerWeek: 0,
      city: addr.city,
      state: addr.state,
    });
  }

  return records;
}

function parse990PFOfficers(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const records: NonprofitRecord[] = [];
  const pf = data.IRS990PF as Record<string, unknown> | undefined;
  if (!pf) return records;

  const infoGrp = pf.OfficerDirTrstKeyEmplInfoGrp as Record<string, unknown> | undefined;
  if (!infoGrp) return records;

  const officers = infoGrp.OfficerDirTrstKeyEmplGrp as Record<string, unknown>[] | undefined;
  if (!officers) return records;

  for (const officer of officers) {
    const rawName = safeStr(officer.PersonNm);
    const parsed = tryParsePerson(rawName);
    if (!parsed) continue;

    const addr = extractAddress(officer.USAddress as Record<string, unknown> | undefined);
    const title = safeStr(officer.TitleTxt);

    records.push({
      source: "990-PF-OFFICER",
      filing,
      personName: rawName,
      personNameNormalized: parsed.normalized,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      middleName: parsed.middleName,
      suffix: parsed.suffix,
      title,
      role: classifyRole(title),
      amount: safeNum(officer.CompensationAmt),
      hoursPerWeek: safeNum(officer.AverageHrsPerWkDevotedToPosRt),
      city: addr.city,
      state: addr.state,
    });
  }

  return records;
}

function parse990Officers(data: Record<string, unknown>, filing: FilingHeader): NonprofitRecord[] {
  const records: NonprofitRecord[] = [];
  const irs990 = data.IRS990 as Record<string, unknown> | undefined;
  if (!irs990) return records;

  const officers = irs990.Form990PartVIISectionAGrp as Record<string, unknown>[] | undefined;
  if (!officers) return records;

  for (const officer of officers) {
    const rawName = safeStr(officer.PersonNm);
    const parsed = tryParsePerson(rawName);
    if (!parsed) continue;

    const title = safeStr(officer.TitleTxt);
    const comp = safeNum(officer.ReportableCompFromOrgAmt) + safeNum(officer.OtherCompensationAmt);

    records.push({
      source: "990-OFFICER",
      filing,
      personName: rawName,
      personNameNormalized: parsed.normalized,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      middleName: parsed.middleName,
      suffix: parsed.suffix,
      title,
      role: classifyRole(title, officer),
      amount: comp,
      hoursPerWeek: safeNum(officer.AverageHoursPerWeekRt),
      city: filing.orgCity,
      state: filing.orgState,
    });
  }

  return records;
}

function parse990PFGrants(data: Record<string, unknown>, filing: FilingHeader): GrantRecord[] {
  const grants: GrantRecord[] = [];
  const pf = data.IRS990PF as Record<string, unknown> | undefined;
  if (!pf) return grants;

  const suppInfo = pf.SupplementaryInformationGrp as Record<string, unknown> | undefined;
  if (!suppInfo) return grants;

  const grantGrps = suppInfo.GrantOrContributionPdDurYrGrp as Record<string, unknown>[] | undefined;
  if (!grantGrps) return grants;

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
} {
  const parsed = parser.parse(xmlContent);
  const ret = parsed?.Return as Record<string, unknown> | undefined;
  if (!ret) return { records: [], grants: [] };

  const filing = parseHeader(ret, objectId);
  if (!filing) return { records: [], grants: [] };

  const data = ret.ReturnData as Record<string, unknown> | undefined;
  if (!data) return { records: [], grants: [] };

  const records: NonprofitRecord[] = [];
  const grants: GrantRecord[] = [];

  if (filing.returnType === "990PF") {
    records.push(...parse990PFDonors(data, filing));
    records.push(...parse990PFOfficers(data, filing));
    grants.push(...parse990PFGrants(data, filing));
  } else {
    records.push(...parse990Officers(data, filing));
  }

  return { records, grants };
}
