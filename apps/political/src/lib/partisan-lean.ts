import { MatchResult } from "../core/types";

export function computePartisanLean(rows: MatchResult[]): string {
  let dem = 0;
  let rep = 0;

  for (const row of rows) {
    if (row.signalType !== "contribution") continue;
    if (row.party === "DEM") dem += row.donationAmount;
    if (row.party === "REP") rep += row.donationAmount;
  }

  const total = dem + rep;
  if (total < 1000) return "Unknown";

  const demPct = (dem / total) * 100;
  if (demPct >= 80) return "Strong D";
  if (demPct >= 60) return "Lean D";
  if (demPct >= 40) return "Mixed";
  if (demPct >= 20) return "Lean R";
  return "Strong R";
}
