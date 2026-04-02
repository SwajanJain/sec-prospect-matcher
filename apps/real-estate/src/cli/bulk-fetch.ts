import path from "node:path";

import { StateStore } from "@pm/core";

import { AttomClient } from "../fetchers/attom";
import { CacheStore } from "../fetchers/cache-store";
import { parseArgs, readEnvFile } from "./util";

export async function bulkFetchCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.counties || !args.start || !args.end) {
    throw new Error(
      "Usage: restate bulk-fetch --counties=11001,36061 --start=YYYY/MM/DD --end=YYYY/MM/DD [--delay=2000]",
    );
  }

  const cwd = process.cwd();
  const envValues = readEnvFile(cwd);
  const apiKeyRaw = process.env.ATTOM_API_KEY ?? envValues.ATTOM_API_KEY ?? "";
  const apiKeys = apiKeyRaw.split(",").map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) throw new Error("Missing ATTOM_API_KEY in environment or .env");

  const root = args["state-dir"] ?? process.env.RESTATE_STATE_DIR ?? envValues.RESTATE_STATE_DIR ?? path.join(cwd, ".restate");
  const stateStore = new StateStore(root);
  stateStore.ensure();

  const client = new AttomClient({ apiKeys });
  const cacheStore = new CacheStore(stateStore);

  const counties = args.counties.split(",").map((c) => c.trim()).filter(Boolean);
  const { start, end } = args;
  const delayMs = Number(args.delay || "2000");

  let countiesComplete = 0;
  let countiesSkipped = 0;
  let countiesFailed = 0;
  let totalPages = 0;
  let totalProperties = 0;

  process.stderr.write(`Bulk fetch: ${counties.length} counties, ${start} → ${end}, ${delayMs}ms delay\n\n`);

  for (let i = 0; i < counties.length; i++) {
    const fips = counties[i];
    const prefix = `[${i + 1}/${counties.length}] ${fips}`;

    // Skip if already fully cached for this exact date range
    const existing = cacheStore.readScanManifest(fips, start, end);
    if (existing?.status === "complete") {
      process.stderr.write(`${prefix}: already cached (${existing.totalPages ?? "?"} pages) — skipping\n`);
      countiesSkipped++;
      continue;
    }

    try {
      let page = existing?.completedPages?.length
        ? Math.max(...existing.completedPages) + 1
        : 1;

      // If we're resuming a partial scan, start from the first missing page
      if (existing?.completedPages?.length) {
        for (let p = 1; p <= (existing.totalPages ?? page); p++) {
          if (!existing.completedPages.includes(p)) { page = p; break; }
        }
      }

      let countyTotalPages: number | undefined = existing?.totalPages ?? undefined;
      let countyProperties = 0;

      while (true) {
        const cached = cacheStore.readPage(fips, start, end, page);
        if (cached) {
          cacheStore.markPageComplete(fips, start, end, page, countyTotalPages);
          page++;
          if (countyTotalPages !== undefined && page > countyTotalPages) break;
          continue;
        }

        process.stderr.write(`${prefix}: fetching page ${page}${countyTotalPages ? `/${countyTotalPages}` : ""}...\r`);
        let result;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            result = await client.fetchCountyPage({ fips, startDate: start, endDate: end, page });
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const isTransient = /504|503|502|ECONNRESET|timeout/i.test(msg);
            if (!isTransient || attempt === 4) throw err;
            const waitMs = attempt * 5000;
            process.stderr.write(`${prefix}: page ${page} attempt ${attempt} failed (${msg.slice(0, 60)}), retrying in ${waitMs / 1000}s...\n`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }
        if (!result) throw new Error("fetch failed after retries");

        if (typeof result.pages === "number") countyTotalPages = result.pages;
        countyProperties += result.properties.length;

        cacheStore.writePage(fips, start, end, page, result);
        cacheStore.markPageComplete(fips, start, end, page, countyTotalPages);
        totalPages++;

        const done = result.properties.length < result.pageSize
          || (typeof countyTotalPages === "number" && page >= countyTotalPages);

        if (done) break;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        page++;
      }

      totalProperties += countyProperties;
      countiesComplete++;
      process.stderr.write(`${prefix}: done — ${countyProperties} properties, ${page} page(s)           \n`);
    } catch (error) {
      countiesFailed++;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${prefix}: FAILED — ${message}\n`);
    }
  }

  process.stderr.write(`\nDone. ${countiesComplete} fetched, ${countiesSkipped} skipped (cached), ${countiesFailed} failed.\n`);
  process.stderr.write(`Total: ${totalPages} API pages, ~${totalProperties} property records.\n`);
}
