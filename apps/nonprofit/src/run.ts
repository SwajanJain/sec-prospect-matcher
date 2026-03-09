import path from "node:path";
import { runNonprofitMatcher } from "./matcher";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (!args.prospects || !args["xml-dir"]) {
  process.stderr.write(
    "Usage: npx tsx apps/nonprofit/src/run.ts \\\n" +
    "  --prospects=<path-to-csv> \\\n" +
    "  --xml-dir=<path-to-xml-dir> \\\n" +
    "  --output-dir=<output-path>\n",
  );
  process.exit(1);
}

const prospectsPath = path.resolve(args.prospects);
const xmlDir = path.resolve(args["xml-dir"]);
const outputDir = path.resolve(args["output-dir"] ?? "output");
const verbose = args.verbose !== "false";

runNonprofitMatcher({ prospectsPath, xmlDir, outputDir, verbose });
