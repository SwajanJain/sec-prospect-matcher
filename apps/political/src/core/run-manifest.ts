import { RunManifest } from "./types";

export function createRunId(asOfDate: Date = new Date()): string {
  const iso = asOfDate.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return `run_${iso}`;
}

export function createEmptyManifest(runId: string, prospectsPath: string, outputDir: string): RunManifest {
  return {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    prospectsPath,
    outputDir,
    sources: ["FEC", "State", "527", "Lobbying"],
    freshness: [],
    counts: {
      totalRecords: 0,
      skippedRecords: 0,
      candidatePairs: 0,
      matchedRows: 0,
      acceptedRows: 0,
      reviewRows: 0,
      rejectedRows: 0,
      matchesBySource: {},
      warnings: [],
    },
    warnings: [],
    degradedSources: [],
    outputs: {
      clientCsv: "",
      reviewCsv: "",
      runSummaryJson: "",
      statsJson: "",
      operatorReportMd: "",
    },
  };
}
