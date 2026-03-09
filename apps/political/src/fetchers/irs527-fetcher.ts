import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { StateStore } from "@pm/core";
import { parse527File } from "../parsers/irs527-parser";

// The IRS POFD download page (https://forms.irs.gov/app/pod/dataDownload/dataDownload)
// is a web form, not a direct download URL. The download requires a POST request
// with specific form parameters. The full database file is available as a ZIP.
const IRS_527_DOWNLOAD_URL = "https://forms.irs.gov/app/pod/dataDownload/fullData";

export async function downloadIrs527Data(stateStore: StateStore): Promise<void> {
  const rawDir = path.join(stateStore.paths.raw, "irs527");
  fs.mkdirSync(rawDir, { recursive: true });

  const response = await fetch(IRS_527_DOWNLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "dataType=FullDataFile",
  });

  if (!response.ok) {
    // Fallback: try GET on the same URL
    const fallbackResponse = await fetch(IRS_527_DOWNLOAD_URL);
    if (!fallbackResponse.ok) {
      process.stderr.write(`[WARN] IRS 527 download failed: ${response.status} ${response.statusText}. ` +
        `The IRS POFD download may require manual download from https://forms.irs.gov/app/pod/dataDownload/dataDownload\n`);
      return;
    }
    const buffer = Buffer.from(await fallbackResponse.arrayBuffer());
    const zipPath = path.join(rawDir, "irs527.zip");
    fs.writeFileSync(zipPath, buffer);
    execFileSync("unzip", ["-o", zipPath, "-d", rawDir]);
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const zipPath = path.join(rawDir, "irs527.zip");
  fs.writeFileSync(zipPath, buffer);
  execFileSync("unzip", ["-o", zipPath, "-d", rawDir]);
}

export function stageIrs527Recent(stateStore: StateStore): number {
  const rawDir = path.join(stateStore.paths.raw, "irs527");
  const filePath = path.join(rawDir, "skeda.txt");
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`[WARN] IRS 527 Schedule A file not found at ${filePath}\n`);
    return 0;
  }
  const rows = parse527File(filePath);
  fs.writeFileSync(path.join(stateStore.paths.recent, "irs527.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return rows.length;
}
