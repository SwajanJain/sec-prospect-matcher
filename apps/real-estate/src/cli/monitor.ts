import path from "node:path";

import { createLogger } from "@pm/core";

import { MonitoringEngine } from "../core/MonitoringEngine";
import { parseArgs } from "./util";

export async function monitorCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.prospects || !args.counties) {
    throw new Error("Usage: restate monitor --prospects=/path/file.csv --counties=11001,36061 [--start=YYYY/MM/DD] [--end=YYYY/MM/DD]");
  }

  const cwd = process.cwd();
  const stateDir = args["state-dir"];
  const outputDir = args.output ?? path.join(stateDir || path.join(cwd, ".restate"), "runs");
  const engine = MonitoringEngine.fromEnv(cwd, stateDir);
  const logger = createLogger(args.verbose !== "false");
  const runId = args["run-id"] ?? `monitor-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  logger.info(`Starting monitoring run ${runId}`);
  const manifest = await engine.execute({
    runId,
    logger,
    prospectsPath: args.prospects,
    counties: args.counties.split(",").map((value) => value.trim()).filter(Boolean),
    startDate: args.start,
    endDate: args.end,
    outputDir,
    scanAll: args["scan-all"] === "true",
  });
  process.stdout.write(`${manifest.outputs.clientCsv}\n`);
}
