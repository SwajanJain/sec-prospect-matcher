import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAttomProperty } from "../src/parsers/source-normalizers";

test("normalizeAttomProperty maps ATTOM payload into canonical property record", () => {
  const property = normalizeAttomProperty({
    identifier: { attomId: "123", apn: "APN-1" },
    address: {
      oneLine: "1 Main St, Austin, TX 78701",
      locality: "Austin",
      countrySubd: "TX",
      postal1: "78701",
      fips: "48453",
      county: "Travis",
    },
    owner: {
      owner1: { fullname: "John Smith", lastname: "Smith", firstnameandmi: "John A" },
      mailingaddressoneline: "500 Elm St, Austin, TX 78702",
      absenteeownerstatus: "O",
    },
    summary: { proptype: "SFR", propclass: "RES" },
    assessment: { assessed: { assdttlvalue: "1200000", assdimprvalue: "850000" } },
    avm: { amount: { value: "1500000" } },
    sale: { saleTransDate: "2026-03-08", amount: { value: "980000" } },
    mortgage: { amount: "400000", lendername: "Test Bank" },
    calendardate: "2026/03/09",
  });

  assert.equal(property.sourcePropertyId, "123");
  assert.equal(property.parsedOwners[0].normalized, "john smith");
  assert.equal(property.ownerMailingCity, "AUSTIN");
  assert.equal(property.estimatedValue, 1500000);
  assert.equal(property.lastSalePrice, 980000);
  assert.equal(property.mortgageLender, "Test Bank");
});
