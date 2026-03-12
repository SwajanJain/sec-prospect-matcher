import { parsePersonName } from "@pm/core";

import type { ParsedOwner, PropertyRecord } from "../core/types";
import { classifyOwnerEntity } from "../lib/owner-entity-classifier";
import { parseOwnerName } from "./owner-name-parser";
import { normalizeAddress } from "./address-normalizer";

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" ? value as AnyRecord : {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeOwner(ownerPayload: AnyRecord): ParsedOwner[] {
  const last = getString(ownerPayload.lastname);
  const firstAndMi = getString(ownerPayload.firstnameandmi);
  const full = getString(ownerPayload.fullname) || [firstAndMi, last].filter(Boolean).join(" ").trim();
  if (!full) return [];

  const parsed = parsePersonName(full);
  if (parsed) {
    return [{
      raw: full,
      normalized: parsed.normalized,
      firstName: parsed.firstName,
      middleName: parsed.middleName,
      lastName: parsed.lastName,
      suffix: parsed.suffix,
      extractedFrom: "direct",
    }];
  }
  return parseOwnerName(full);
}

export function normalizeAttomProperty(payload: unknown): PropertyRecord {
  const root = asRecord(payload);
  const identifier = asRecord(root.identifier);
  const address = asRecord(root.address);
  const summary = asRecord(root.summary);
  const assessment = asRecord(root.assessment);
  const assessed = asRecord(assessment.assessed);
  const avm = asRecord(asRecord(root.avm).amount);
  const sale = asRecord(root.sale);
  const saleAmount = asRecord(sale.amount);
  const mortgage = asRecord(root.mortgage);
  const owner = asRecord(root.owner);

  const ownerPayloads = [owner.owner1, owner.owner2, owner.owner3, owner.owner4].map(asRecord);
  const parsedOwners = ownerPayloads.flatMap(normalizeOwner);
  const ownerRaw = ownerPayloads.map((entry) => getString(entry.fullname)).filter(Boolean).join(" | ");
  const ownerMailingAddress = getString(owner.mailingaddressoneline);
  const mailing = normalizeAddress(ownerMailingAddress);
  const situs = normalizeAddress(getString(address.oneLine) || getString(address.line1));
  const ownerType = classifyOwnerEntity(ownerRaw || getString(owner.owner1));
  const absenteeStatus = getString(owner.absenteeownerstatus).toUpperCase();

  return {
    source: "attom",
    sourcePropertyId: String(identifier.attomId ?? identifier.Id ?? identifier.id ?? root.id ?? ""),
    parcelId: getString(identifier.apn),
    countyFips: getString(address.fips),
    county: getString(address.county),
    sourceCalendardate: getString(root.calendardate),
    situsAddress: getString(address.oneLine) || getString(address.line1) || situs?.line1 || "",
    situsCity: getString(address.locality) || situs?.city,
    situsState: getString(address.countrySubd) || situs?.state,
    situsZip: getString(address.postal1) || situs?.zip,
    ownerRaw,
    ownerRaw2: getString(asRecord(owner.owner2).fullname),
    ownerType,
    parsedOwners,
    ownerMailingAddress,
    ownerMailingCity: mailing?.city,
    ownerMailingState: mailing?.state,
    ownerMailingZip: mailing?.zip,
    propertyType: getString(summary.proptype),
    useCode: getString(summary.propclass),
    assessedLand: getNumber(assessed.assdlandvalue),
    assessedImprovement: getNumber(assessed.assdimprvalue),
    assessedTotal: getNumber(assessed.assdttlvalue),
    estimatedValue: getNumber(avm.value),
    lastSaleDate: getString(sale.saleTransDate) || getString(sale.salesearchdate),
    lastSalePrice: getNumber(saleAmount.value ?? sale.amount),
    mortgageAmount: getNumber(mortgage.amount),
    mortgageLender: getString(mortgage.lendername),
    isOwnerOccupied: absenteeStatus === "O",
    isAbsenteeOwner: absenteeStatus === "A",
    raw: payload,
  };
}
