import fs from "node:fs";

export interface CommitteeRecord {
  committeeId: string;
  committeeName: string;
  committeeDesignation: string;
  committeeType: string;
  committeeParty: string;
  connectedOrgName: string;
  candidateId: string;
}

export function loadCommittees(filePath: string): Map<string, CommitteeRecord> {
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const results = new Map<string, CommitteeRecord>();

  for (const row of rows) {
    const columns = row.split("|");
    if (columns.length < 15) continue;
    const [
      committeeId,
      committeeName,
      _treasurerName,
      _street1,
      _street2,
      _city,
      _state,
      _zip,
      committeeDesignation,
      committeeType,
      committeeParty,
      _filingFrequency,
      _orgType,
      connectedOrgName,
      candidateId,
    ] = columns;
    results.set(committeeId, {
      committeeId,
      committeeName,
      committeeDesignation,
      committeeType,
      committeeParty,
      connectedOrgName,
      candidateId,
    });
  }

  return results;
}
