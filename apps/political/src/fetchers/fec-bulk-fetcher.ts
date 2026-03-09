import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

import { StateStore } from "@pm/core";

async function buildSubIdSet(filePath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!fs.existsSync(filePath)) return ids;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const columns = line.split("|");
    if (columns.length >= 21) ids.add(columns[20]);
  }
  return ids;
}

export async function downloadFecBulkFiles(stateStore: StateStore, cycleYear = "2026"): Promise<void> {
  const baseUrl = `https://www.fec.gov/files/bulk-downloads/${cycleYear}`;
  const rawDir = path.join(stateStore.paths.raw, "fec");
  const currentDir = path.join(rawDir, "current");
  fs.mkdirSync(currentDir, { recursive: true });

  const files = [
    { name: `indiv${cycleYear.slice(-2)}.zip`, output: "indiv.zip" },
    { name: `cm${cycleYear.slice(-2)}.zip`, output: "cm.zip" },
    { name: `cn${cycleYear.slice(-2)}.zip`, output: "cn.zip" },
    { name: `ccl${cycleYear.slice(-2)}.zip`, output: "ccl.zip" },
  ];

  for (const file of files) {
    const response = await fetch(`${baseUrl}/${file.name}`);
    if (!response.ok) {
      throw new Error(`Failed to download ${file.name}: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(currentDir, file.output), buffer);
  }

  for (const zipName of ["indiv.zip", "cm.zip", "cn.zip", "ccl.zip"]) {
    execFileSync("unzip", ["-o", path.join(currentDir, zipName), "-d", currentDir]);
  }

  const lookupCopies = [
    { source: path.join(currentDir, "cm.txt"), dest: path.join(stateStore.paths.lookups, "cm.txt") },
    { source: path.join(currentDir, "cn.txt"), dest: path.join(stateStore.paths.lookups, "cn.txt") },
    { source: path.join(currentDir, "ccl.txt"), dest: path.join(stateStore.paths.lookups, "ccl.txt") },
  ];

  for (const copy of lookupCopies) {
    if (fs.existsSync(copy.source)) {
      fs.copyFileSync(copy.source, copy.dest);
    }
  }
}

export async function extractNewFecRecords(stateStore: StateStore): Promise<number> {
  const rawDir = path.join(stateStore.paths.raw, "fec");
  const currentFile = path.join(rawDir, "current", "itcont.txt");
  const previousFile = path.join(rawDir, "previous", "itcont.txt");
  if (!fs.existsSync(currentFile)) {
    throw new Error(`Missing current FEC individual file: ${currentFile}`);
  }

  const previousIds = await buildSubIdSet(previousFile);
  const outputFile = path.join(stateStore.paths.recent, "fec-individual.txt");
  const writer = fs.createWriteStream(outputFile, "utf8");
  let count = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(currentFile),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const columns = line.split("|");
    if (columns.length < 21) continue;
    const subId = columns[20];
    if (!previousIds.has(subId)) {
      writer.write(`${line}\n`);
      count += 1;
    }
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(() => resolve());
    writer.on("error", reject);
  });

  const previousDir = path.join(rawDir, "previous");
  fs.mkdirSync(previousDir, { recursive: true });
  fs.copyFileSync(currentFile, previousFile);
  return count;
}
