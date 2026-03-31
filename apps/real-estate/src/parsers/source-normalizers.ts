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

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = getString(value);
    if (normalized) return normalized;
  }
  return "";
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
  const last = firstString(ownerPayload.lastname, ownerPayload.lastName);
  const firstAndMi = firstString(ownerPayload.firstnameandmi, ownerPayload.firstNameAndMi);
  const full = firstString(ownerPayload.fullname, ownerPayload.fullName) || [firstAndMi, last].filter(Boolean).join(" ").trim();
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
  const owner = asRecord(assessment.owner);

  const ownerPayloads = [owner.owner1, owner.owner2, owner.owner3, owner.owner4].map(asRecord);
  const parsedOwners = ownerPayloads.flatMap(normalizeOwner);
  const ownerRaw = ownerPayloads.map((entry) => firstString(entry.fullname, entry.fullName)).filter(Boolean).join(" | ");
  const ownerMailingAddress = firstString(owner.mailingaddressoneline, owner.mailingAddressOneLine);
  const mailing = normalizeAddress(ownerMailingAddress);
  const situs = normalizeAddress(firstString(address.oneLine, address.line1));
  const ownerType = classifyOwnerEntity(ownerRaw || getString(owner.owner1));
  const absenteeStatus = firstString(owner.absenteeownerstatus, owner.absenteeOwnerStatus).toUpperCase();
  const sellerRaw = getString(sale.sellerName);
  const parsedSellers = parseOwnerName(sellerRaw);
  const saleRecordDate = firstString(saleAmount.saleRecDate, saleAmount.salerecdate);
  const saleTransactionDate = firstString(sale.saleTransDate, sale.saleTransdate);
  const saleSearchDate = firstString(sale.saleSearchDate, sale.salesearchdate);
  const saleAmountValue = getNumber(saleAmount.saleAmt ?? saleAmount.value ?? sale.amount);
  const saleDocumentNumber = firstString(saleAmount.saleDocNum, saleAmount.saledocnum);
  const saleTransactionType = firstString(saleAmount.saleTransType, saleAmount.saleTranstype);
  const quitClaimFlag = firstString(summary.quitClaimFlag, summary.quitclaimflag);
  const propertyType = firstString(summary.propType, summary.proptype);
  const assessedTotal = getNumber(assessed.assdTtlValue ?? assessed.assdttlvalue);

  return {
    source: "attom",
    sourcePropertyId: String(identifier.attomId ?? identifier.Id ?? identifier.id ?? root.id ?? ""),
    parcelId: getString(identifier.apn),
    countyFips: getString(address.fips),
    county: getString(address.county),
    sourceCalendardate: firstString(root.calendardate, root.calendarDate),
    situsAddress: firstString(address.oneLine, address.line1) || situs?.line1 || "",
    situsCity: getString(address.locality) || situs?.city,
    situsState: getString(address.countrySubd) || situs?.state,
    situsZip: getString(address.postal1) || situs?.zip,
    ownerRaw,
    ownerRaw2: firstString(asRecord(owner.owner2).fullname, asRecord(owner.owner2).fullName),
    ownerType,
    parsedOwners,
    sellerRaw,
    parsedSellers,
    ownerMailingAddress,
    ownerMailingCity: mailing?.city,
    ownerMailingState: mailing?.state,
    ownerMailingZip: mailing?.zip,
    propertyType,
    useCode: getString(summary.propclass),
    assessedLand: getNumber(assessed.assdLandValue ?? assessed.assdlandvalue),
    assessedImprovement: getNumber(assessed.assdImprValue ?? assessed.assdimprvalue),
    assessedTotal,
    estimatedValue: getNumber(avm.value),
    lastSaleDate: saleRecordDate || saleTransactionDate || saleSearchDate,
    lastSalePrice: saleAmountValue,
    saleRecordDate,
    saleTransactionDate,
    saleSearchDate,
    saleDocumentNumber,
    saleTransactionType,
    saleTransactionId: getString(sale.transactionIdent),
    quitClaimFlag,
    mortgageAmount: getNumber(mortgage.amount),
    mortgageLender: getString(mortgage.lendername),
    isOwnerOccupied: absenteeStatus === "O",
    isAbsenteeOwner: absenteeStatus === "A",
    raw: payload,
  };
}
