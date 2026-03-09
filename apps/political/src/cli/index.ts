#!/usr/bin/env node

import { fetchCli } from "./fetch";
import { inspectCli } from "./inspect";
import { runCli } from "./run";
import { validateCli } from "./validate";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "run":
      await runCli(rest);
      return;
    case "fetch":
      await fetchCli(rest);
      return;
    case "validate":
      await validateCli(rest);
      return;
    case "inspect":
      await inspectCli(rest);
      return;
    default:
      throw new Error("Usage: pfund <run|fetch|validate|inspect> ...");
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
