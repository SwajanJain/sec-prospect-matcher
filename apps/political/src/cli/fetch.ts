import fs from "node:fs";
import path from "node:path";

import { createLogger, loadConfig, StateStore } from "@pm/core";
import { downloadFecBulkFiles, extractNewFecRecords } from "../fetchers/fec-bulk-fetcher";
import { fetchRecentFecApi } from "../fetchers/fec-api-fetcher";
import { downloadIrs527Data, stageIrs527Recent } from "../fetchers/irs527-fetcher";
import { fetchStateContributions } from "../fetchers/state-fetcher";
import { fetchLdaContributions } from "../fetchers/lda-fetcher";

function hasFecLookups(stateStore: StateStore): boolean {
  return ["cm.txt", "cn.txt", "ccl.txt"]
    .every((fileName) => fs.existsSync(path.join(stateStore.paths.lookups, fileName)));
}

export async function fetchCli(args: string[]): Promise<void> {
  const mode = args[0];
  if (mode !== "weekly" && mode !== "daily") {
    throw new Error("Usage: pfund fetch <weekly|daily>");
  }

  const config = loadConfig(process.cwd());
  const stateStore = new StateStore(config.stateDir);
  stateStore.ensure();
  const logger = createLogger(true);
  const lockPath = stateStore.acquireLock("state");

  try {
    if (mode === "weekly") {
      if (hasFecLookups(stateStore)) {
        logger.info("Using existing FEC lookups; skipping bulk refresh");
      } else {
        logger.info("Downloading FEC bulk files");
        await downloadFecBulkFiles(stateStore);
        const count = await extractNewFecRecords(stateStore);
        logger.info(`Staged ${count} new FEC records`);
      }
      logger.info("Downloading IRS 527 data");
      await downloadIrs527Data(stateStore);
      logger.info(`Staged ${await stageIrs527Recent(stateStore)} IRS 527 rows`);
      return;
    }

    const today = new Date();
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const minDate = ninetyDaysAgo.toISOString().slice(0, 10);

    if (config.fecApiKey) {
      logger.info("Fetching OpenFEC recent contributions (≥$200, last 90 days)");
      await fetchRecentFecApi({
        apiKey: config.fecApiKey,
        minDate,
        minAmount: 200,
        twoYearPeriod: "2026",
        stateStore,
      });
    }
    try {
      await fetchStateContributions(config.ftmApiKey, stateStore);
    } catch (error) {
      logger.warn(`State fetch failed: ${String(error)}`);
    }
    try {
      const rows = await fetchLdaContributions(config.ldaApiKey, stateStore);
      logger.info(`Staged ${rows.length} Lobbying rows`);
    } catch (error) {
      logger.warn(`LDA fetch failed: ${String(error)}`);
    }
  } finally {
    stateStore.releaseLock(lockPath);
  }
}
