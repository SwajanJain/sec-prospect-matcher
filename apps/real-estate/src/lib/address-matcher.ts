import type { AddressMatchResult } from "../core/types";
import { normalizeAddress } from "../parsers/address-normalizer";

export function compareAddresses(
  prospectAddress: string | undefined,
  propertyAddresses: { situs?: string; mailing?: string },
): AddressMatchResult {
  const prospect = normalizeAddress(prospectAddress);
  if (!prospect) return { status: "mismatch", confidence: 0, matchedAgainst: "none" };

  const mailing = normalizeAddress(propertyAddresses.mailing);
  const situs = normalizeAddress(propertyAddresses.situs);

  // Mailing address = where the owner lives → strongest identity corroboration
  if (mailing) {
    // Tier 1: full street address match (fires when prospect has a street address)
    if (prospect.line1 && prospect.line1 !== "UNKNOWN"
        && prospect.normalizedKey && prospect.normalizedKey === mailing.normalizedKey) {
      return { status: "mailing_exact", confidence: 100, matchedAgainst: "mailing" };
    }
    // Tier 2: ZIP match (fires when prospect has a ZIP code)
    if (prospect.zip && prospect.zip === mailing.zip) {
      return { status: "mailing_zip", confidence: 80, matchedAgainst: "mailing" };
    }
    // Tier 3: city + state match (current best we can do without street/ZIP)
    if (prospect.city && prospect.state && prospect.city === mailing.city && prospect.state === mailing.state) {
      return { status: "mailing_city_state", confidence: 55, matchedAgainst: "mailing" };
    }
    // Tier 4: state only
    if (prospect.state && prospect.state === mailing.state) {
      return { status: "mailing_state", confidence: 15, matchedAgainst: "mailing" };
    }
  }

  // Situs address = where the property is → weaker (investment/vacation properties are anywhere)
  if (situs) {
    if (prospect.city && prospect.state && prospect.city === situs.city && prospect.state === situs.state) {
      return { status: "situs_city_state", confidence: 30, matchedAgainst: "situs" };
    }
    if (prospect.state && prospect.state === situs.state) {
      return { status: "situs_state", confidence: 5, matchedAgainst: "situs" };
    }
  }

  return { status: "mismatch", confidence: 0, matchedAgainst: "none" };
}
