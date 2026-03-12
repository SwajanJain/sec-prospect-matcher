import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createLogger, StateStore } from "@pm/core";

import { MonitoringEngine } from "../src/core/MonitoringEngine";
import type { AttomApiResponse } from "../src/core/types";
import { CacheStore } from "../src/fetchers/cache-store";
import { AttomClient } from "../src/fetchers/attom";

function writeFixture(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("MonitoringEngine produces an alert CSV from ATTOM county scan", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-monitor-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const cacheStore = new CacheStore(stateStore);
  const outputDir = path.join(tempDir, "runs");
  const prospectsPath = path.join(tempDir, "prospects.csv");

  writeFixture(
    prospectsPath,
    [
      "prospect_id,name,city,state",
      "p1,John Smith,Austin,TX",
      "p2,Jane Doe,Seattle,WA",
    ].join("\n"),
  );

  cacheStore.writePriorStates([{
    sourcePropertyId: "123",
    ownerFingerprints: ["mary seller"],
    lastSaleDate: "2024-01-01",
    lastSalePrice: 700000,
    mortgageAmount: 300000,
    assessedTotal: 900000,
    lastSeen: "2026-03-08T00:00:00.000Z",
  }]);

  const payload: AttomApiResponse = {
    property: [{
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
      assessment: { assessed: { assdttlvalue: "1200000" } },
      avm: { amount: { value: "1500000" } },
      sale: { saleTransDate: "2026-03-08", amount: { value: "980000" } },
      mortgage: { amount: "400000", lendername: "Test Bank" },
      calendardate: "2026/03/09",
    }],
    status: {
      total: 1,
      page: 1,
      pagesize: 100,
      pages: 1,
    },
  };

  const client = new AttomClient({
    apiKeys: ["test"],
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
  });

  const engine = new MonitoringEngine({
    attomClient: client,
    cacheStore,
    logger: createLogger(false),
  });

  const manifest = await engine.execute({
    runId: "test-run",
    logger: createLogger(false),
    prospectsPath,
    counties: ["48453"],
    startDate: "2026/03/09",
    endDate: "2026/03/09",
    outputDir,
  });

  const clientCsv = fs.readFileSync(manifest.outputs.clientCsv, "utf8");
  assert.match(clientCsv, /John Smith/);
  assert.match(clientCsv, /owner_change/);
});
