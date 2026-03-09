import { NormalizedContribution } from "../core/types";
import { StateStore } from "@pm/core";

// TODO: Not yet implemented. The Senate LDA API returns LD-203 filing objects
// with nested contributor/payee/registrant structures, not flat contributions.
// Requires proper normalization before this can work.
export async function fetchLdaContributions(_apiKey: string, _stateStore: StateStore): Promise<NormalizedContribution[]> {
  process.stderr.write("[WARN] LDA fetcher not yet implemented — returning empty results\n");
  return [];
}
