import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";

import { StateStore } from "@pm/core";
import { FetchArtifactMeta } from "../core/types";
import { normalize527Date, parse527Record } from "../parsers/irs527-parser";

const IRS_527_DOWNLOAD_URL = "https://forms.irs.gov/app/pod/dataDownload/fullData";
const META_FILENAME = "irs527.meta.json";
const DEFAULT_BOOTSTRAP_DAYS = 90;

interface StageIrs527Options {
  asOfDate?: Date;
  bootstrapDays?: number;
}

function resolveScheduleAPath(baseDir: string): string {
  const candidates = [
    path.join(baseDir, "skeda.txt"),
    path.join(baseDir, "var", "IRS", "data", "scripts", "pofd", "download", "FullDataFile.txt"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function buildScheduleAKey(line: string): string | null {
  const columns = line.split("|");
  if (columns.length < 17 || columns[0] !== "A") return null;

  const formId = (columns[1] || "").trim();
  const scheduleAId = (columns[2] || "").trim();
  const recipientName = (columns[3] || "").trim().toLowerCase();
  const donorName = (columns[5] || "").trim().toLowerCase();
  const amount = (columns[13] || "").trim();
  const donationDate = normalize527Date(columns[16] || "");

  return [formId, scheduleAId, recipientName, donorName, amount, donationDate].join("|");
}

async function buildScheduleAKeySet(filePath: string): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!fs.existsSync(filePath)) return keys;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const key = buildScheduleAKey(line);
    if (key) keys.add(key);
  }

  return keys;
}

async function downloadToFile(response: Response, destination: string): Promise<void> {
  if (!response.ok || !response.body) {
    throw new Error(`IRS 527 download failed: ${response.status} ${response.statusText}`);
  }

  const totalBytes = Number(response.headers.get("content-length") || "0");
  let downloadedBytes = 0;
  let lastLoggedBytes = 0;
  const progressChunk = 25 * 1024 * 1024;

  const source = Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (downloadedBytes - lastLoggedBytes >= progressChunk) {
      lastLoggedBytes = downloadedBytes;
      const totalMb = totalBytes > 0 ? ` / ${(totalBytes / (1024 * 1024)).toFixed(0)} MB` : "";
      process.stderr.write(`[INFO] Downloaded ${(downloadedBytes / (1024 * 1024)).toFixed(0)} MB${totalMb} from IRS 527 feed\n`);
    }
  });

  await pipeline(source, fs.createWriteStream(destination));
}

function writeStageMetadata(stateStore: StateStore, metadata: FetchArtifactMeta): void {
  fs.writeFileSync(
    path.join(stateStore.paths.recent, META_FILENAME),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

export async function downloadIrs527Data(stateStore: StateStore): Promise<void> {
  const rawDir = path.join(stateStore.paths.raw, "irs527");
  const currentDir = path.join(rawDir, "current");
  fs.rmSync(currentDir, { recursive: true, force: true });
  fs.mkdirSync(currentDir, { recursive: true });

  const zipPath = path.join(currentDir, "irs527.zip");
  const response = await fetch(IRS_527_DOWNLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "dataType=FullDataFile",
  });

  if (response.ok) {
    await downloadToFile(response, zipPath);
  } else {
    const fallbackResponse = await fetch(IRS_527_DOWNLOAD_URL);
    await downloadToFile(fallbackResponse, zipPath);
  }

  execFileSync("unzip", ["-o", zipPath, "-d", currentDir]);
}

export async function stageIrs527Recent(
  stateStore: StateStore,
  options: StageIrs527Options = {},
): Promise<number> {
  const rawDir = path.join(stateStore.paths.raw, "irs527");
  const currentFile = resolveScheduleAPath(path.join(rawDir, "current"));
  const previousFile = path.join(rawDir, "previous", "skeda.txt");
  if (!fs.existsSync(currentFile)) {
    process.stderr.write(`[WARN] IRS 527 Schedule A file not found at ${currentFile}\n`);
    writeStageMetadata(stateStore, {
      source: "527",
      status: "failed",
      fetchedAt: new Date().toISOString(),
      recordsFetched: 0,
      pagesFetched: 0,
      requestCount: 0,
      error: `Missing current Schedule A file: ${currentFile}`,
      mode: "missing_current",
    });
    return 0;
  }

  const bootstrapDays = options.bootstrapDays ?? DEFAULT_BOOTSTRAP_DAYS;
  const hasPrevious = fs.existsSync(previousFile);
  const previousKeys = hasPrevious ? await buildScheduleAKeySet(previousFile) : new Set<string>();
  const bootstrapThreshold = new Date((options.asOfDate ?? new Date()).getTime() - bootstrapDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows: import("../core/types").NormalizedContribution[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(currentFile),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    const key = buildScheduleAKey(line);
    if (!key) continue;
    if (hasPrevious && previousKeys.has(key)) continue;

    const row = parse527Record(line, `skeda.txt:${lineNumber}`);
    if (!row) continue;

    if (!hasPrevious && (!row.donationDate || row.donationDate < bootstrapThreshold)) {
      continue;
    }

    rows.push(row);
  }

  fs.writeFileSync(path.join(stateStore.paths.recent, "irs527.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  writeStageMetadata(stateStore, {
    source: "527",
    status: "complete",
    fetchedAt: new Date().toISOString(),
    recordsFetched: rows.length,
    pagesFetched: 1,
    requestCount: 0,
    mode: hasPrevious ? "diff" : "bootstrap_recent",
  });

  const previousDir = path.join(rawDir, "previous");
  fs.mkdirSync(previousDir, { recursive: true });
  fs.copyFileSync(currentFile, previousFile);

  return rows.length;
}
