import fs from "node:fs";

export interface CandidateRecord {
  candidateId: string;
  candidateName: string;
  party: string;
  officeState: string;
  office: string;
  officeDistrict: string;
}

export function loadCandidates(filePath: string): Map<string, CandidateRecord> {
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const results = new Map<string, CandidateRecord>();

  for (const row of rows) {
    const columns = row.split("|");
    if (columns.length < 10) continue;
    const [candidateId, candidateName, party, _electionYear, officeState, office, officeDistrict] = columns;
    results.set(candidateId, {
      candidateId,
      candidateName,
      party,
      officeState,
      office,
      officeDistrict,
    });
  }

  return results;
}
