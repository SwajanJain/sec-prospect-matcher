import path from "node:path";

import { PoliticalMatcher } from "../core/PoliticalMatcher";
import { createRunId } from "../core/run-manifest";
import { createLogger, loadConfig, StateStore } from "@pm/core";

export async function runCli(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const prospectsPath = readFlag(args, "--prospects");
  if (!prospectsPath) {
    throw new Error("Missing required flag: --prospects <path>");
  }

  const config = loadConfig(cwd, {
    stateDir: readFlag(args, "--state-dir"),
    outputDir: readFlag(args, "--output-dir"),
  });
  const logger = createLogger(true);
  const stateStore = new StateStore(config.stateDir);
  stateStore.ensure();

  const runId = createRunId();
  const lockPath = stateStore.acquireLock("state");
  try {
    const resolvedProspectsPath = path.resolve(prospectsPath);
    if (!config.ldaApiKey) {
      logger.info("LDA_API_KEY missing; run will use only staged lobbying data");
    }

    const matcher = new PoliticalMatcher({
      runId,
      logger,
      stateStore,
      outputDir: config.outputDir,
      maxProspectSkipRate: config.maxProspectSkipRate,
    });
    const manifest = matcher.execute(resolvedProspectsPath);
    process.stdout.write(`${JSON.stringify(manifest.outputs, null, 2)}\n`);
  } finally {
    stateStore.releaseLock(lockPath);
  }
}

function readFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? "" : "";
}
