import fs from "node:fs";

export function loadLinkages(filePath: string): Map<string, string> {
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const results = new Map<string, string>();

  for (const row of rows) {
    const columns = row.split("|");
    if (columns.length < 4) continue;
    const [candidateId, _candidateElectionYear, _fecElectionYear, committeeId] = columns;
    if (!results.has(committeeId)) {
      results.set(committeeId, candidateId);
    }
  }

  return results;
}
