import { loadProspects } from "@pm/core";

export async function validateCli(args: string[]): Promise<void> {
  if (args[0] !== "prospects" || !args[1]) {
    throw new Error("Usage: pfund validate prospects <path>");
  }
  const prospects = loadProspects(args[1]);
  process.stdout.write(`${JSON.stringify({ valid: true, count: prospects.length }, null, 2)}\n`);
}
