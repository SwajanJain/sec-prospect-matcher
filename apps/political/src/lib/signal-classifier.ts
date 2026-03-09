import { MatchResult, SourceName } from "../core/types";

export interface DonationClassification {
  tier: number;
  action: string;
}

export function classifyDonation(amount: number, recipientName: string, recipientType: string): DonationClassification {
  if (amount >= 3500) {
    return {
      tier: 1,
      action: `Maxed or near-max political donation to ${recipientName || recipientType}. Treat as a high-capacity signal.`,
    };
  }

  if (amount >= 1000) {
    return {
      tier: 2,
      action: `Significant political donation to ${recipientName || recipientType}. This is a strong capacity signal.`,
    };
  }

  return {
    tier: 3,
    action: `Political donation to ${recipientName || recipientType}. Monitor for broader pattern.`,
  };
}

export function classifyProspectAggregate(rows: MatchResult[]): { tier: number; flags: string[]; action: string } {
  const total = rows.reduce((sum, row) => sum + row.donationAmount, 0);
  const maxOutCount = rows.filter((row) => row.donationAmount >= 3500).length;
  const flags = new Set<string>();
  const sources = new Set<SourceName>();

  for (const row of rows) {
    sources.add(row.dataSource);
    if (row.donationAmount >= 3500) flags.add("Max-Out Donor");
    if (row.dataSource === "Lobbying") flags.add("Lobbyist");
    if (row.dataSource === "527") flags.add("527 Donor");
    if (row.dataSource === "State") flags.add("State Donor");
  }

  if (sources.size > 1) flags.add("Multi-Source");

  if (total >= 10000 || maxOutCount >= 3) {
    return {
      tier: 1,
      flags: Array.from(flags),
      action: `High-capacity political donor with ${rows.length} recent donations totaling $${total.toFixed(2)}.`,
    };
  }

  if (rows.length >= 2 || total >= 1000) {
    return {
      tier: 2,
      flags: Array.from(flags),
      action: `Active political donor with ${rows.length} recent donations totaling $${total.toFixed(2)}.`,
    };
  }

  return {
    tier: 3,
    flags: Array.from(flags),
    action: `Single recent political donation totaling $${total.toFixed(2)}.`,
  };
}
