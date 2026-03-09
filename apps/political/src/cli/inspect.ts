import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "@pm/core";

export async function inspectCli(args: string[]): Promise<void> {
  if (args[0] !== "run" || !args[1]) {
    throw new Error("Usage: pfund inspect run <run-id>");
  }

  const config = loadConfig(process.cwd());
  const manifestPath = path.join(config.outputDir, args[1], "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Run manifest not found: ${manifestPath}`);
  }

  process.stdout.write(fs.readFileSync(manifestPath, "utf8"));
}
