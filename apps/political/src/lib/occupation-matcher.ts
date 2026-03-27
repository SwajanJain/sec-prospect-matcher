export interface OccupationMatchResult {
  status: "corroborated" | "neutral";
  detail: string;
}

type IndustryCategory =
  | "legal"
  | "healthcare"
  | "tech"
  | "education"
  | "finance"
  | "real_estate"
  | "government"
  | "energy"
  | "media"
  | "construction"
  | "consulting"
  | "nonprofit";

const OCCUPATION_KEYWORDS: Array<[RegExp, IndustryCategory]> = [
  [/\b(attorney|lawyer|counsel|legal|paralegal|solicitor|barrister|litigat)\b/i, "legal"],
  [/\b(physician|doctor|surgeon|nurse|dentist|pharmacist|medical|healthcare|health care|hospital|clinic|therapist|psychiatr|psycholog|veterinar|optometri|chiropract|radiolog|anesthes|patholog|cardiolog|dermatolog|oncolog|pediatr|neurolog|orthoped)\b/i, "healthcare"],
  [/\b(engineer|developer|programmer|software|computer|data scientist|it manager|cto|cio|cyber|devops|architect.*software|sysadmin|tech)\b/i, "tech"],
  [/\b(teacher|professor|educator|principal|dean|academic|faculty|instructor|superintendent|school|university|college)\b/i, "education"],
  [/\b(banker|financial|finance|accountant|cpa|auditor|actuary|analyst.*finance|investment|portfolio|wealth|asset manage|hedge fund|venture capital|private equity|underwriter|broker|trader|cfo)\b/i, "finance"],
  [/\b(realtor|real estate|property|broker.*real|appraiser|mortgage|title.*officer)\b/i, "real_estate"],
  [/\b(government|federal|state.*employ|public.*servant|civil.*service|diplomat|military|army|navy|air force|marine|police|sheriff|fire.*fight|judge|magistrate|legislat|congress|senator|mayor|governor|city.*manager|county.*admin)\b/i, "government"],
  [/\b(oil|gas|petroleum|energy|mining|drilling|utility|power.*plant|solar|wind.*energy|nuclear)\b/i, "energy"],
  [/\b(journalist|reporter|editor|publisher|media|broadcast|news|television|radio|film|producr|director.*film|writer.*screen|anchor)\b/i, "media"],
  [/\b(construct|builder|contractor|architect(?!.*software)|plumber|electrician|carpenter|mason|roofing|paving|excavat)\b/i, "construction"],
  [/\b(consultant|advisory|advisor|consulting)\b/i, "consulting"],
  [/\b(nonprofit|non-profit|foundation|charity|ngo|philanthrop|social.*work|ministry|pastor|clergy|rabbi|imam)\b/i, "nonprofit"],
];

const COMPANY_KEYWORDS: Array<[RegExp, IndustryCategory]> = [
  [/\b(law|legal|attorneys?|counsel|litigation|& associates)\b/i, "legal"],
  [/\b(hospital|medical|health|clinic|pharma|biotech|therapeut|surgical|dental|veterinar|labs?)\b/i, "healthcare"],
  [/\b(tech|software|computing|digital|data|cyber|systems|solutions|network|cloud|ai\b|semiconductor|microsoft|google|apple|meta|amazon|ibm|oracle|cisco|intel|salesforce)\b/i, "tech"],
  [/\b(university|college|school|academy|institute|education|learning)\b/i, "education"],
  [/\b(bank|financial|capital|invest|securities|insurance|fidelity|schwab|morgan|goldman|jpmorgan|wells fargo|merrill|vanguard|blackrock)\b/i, "finance"],
  [/\b(real estate|realty|properties|homes|housing|mortgage|title)\b/i, "real_estate"],
  [/\b(department of|city of|county of|state of|federal|government|municipality|agency|bureau|commission|authority)\b/i, "government"],
  [/\b(energy|oil|gas|petroleum|mining|utility|power|solar|wind|nuclear|exxon|chevron|shell|bp\b)\b/i, "energy"],
  [/\b(media|news|broadcast|publish|entertainment|television|radio|film|studio|press|times|tribune|journal|gazette)\b/i, "media"],
  [/\b(construct|building|builders?|contractors?|architect|engineering|roofing|plumbing|electric)\b/i, "construction"],
  [/\b(consult|advisory|advisors?|deloitte|mckinsey|accenture|pwc|kpmg|ernst|bain\b|bcg\b)\b/i, "consulting"],
  [/\b(foundation|charity|trust|humanitarian|united way|red cross|salvation army|habitat|goodwill)\b/i, "nonprofit"],
];

const NON_INFORMATIVE_OCCUPATIONS = new Set([
  "retired", "self-employed", "self employed", "self", "none", "n/a", "na",
  "not employed", "homemaker", "home maker", "student", "unemployed",
  "information requested", "information requested per best efforts",
  "owner", "president", "ceo", "executive", "manager", "director",
  "vice president", "vp", "partner", "principal", "chairman",
  "business owner", "entrepreneur", "investor",
]);

export function classifyOccupation(occupation: string): IndustryCategory | null {
  const trimmed = (occupation || "").trim();
  if (!trimmed || NON_INFORMATIVE_OCCUPATIONS.has(trimmed.toLowerCase())) return null;
  for (const [pattern, category] of OCCUPATION_KEYWORDS) {
    if (pattern.test(trimmed)) return category;
  }
  return null;
}

function classifyCompany(company: string): IndustryCategory | null {
  const trimmed = (company || "").trim();
  if (!trimmed) return null;
  for (const [pattern, category] of COMPANY_KEYWORDS) {
    if (pattern.test(trimmed)) return category;
  }
  return null;
}

export function matchOccupation(
  prospectCompanies: string[],
  donorOccupation: string,
): OccupationMatchResult {
  const occupationCategory = classifyOccupation(donorOccupation);
  if (!occupationCategory) {
    return { status: "neutral", detail: "Non-informative or unclassifiable occupation" };
  }

  for (const company of prospectCompanies) {
    const companyCategory = classifyCompany(company);
    if (companyCategory && companyCategory === occupationCategory) {
      return {
        status: "corroborated",
        detail: `Occupation "${donorOccupation}" corroborates company "${company}" (${occupationCategory})`,
      };
    }
  }

  return { status: "neutral", detail: `Occupation "${donorOccupation}" (${occupationCategory}) — no company match` };
}
