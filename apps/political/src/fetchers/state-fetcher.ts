import { NormalizedContribution } from "../core/types";
import { StateStore } from "@pm/core";

// TODO: Not yet implemented. The real FollowTheMoney API uses the "Ask Anything"
// endpoint with a completely different schema. The API is also in maintenance mode
// (merged with OpenSecrets June 2021) and may sunset.
export async function fetchStateContributions(_apiKey: string, _stateStore: StateStore): Promise<NormalizedContribution[]> {
  process.stderr.write("[WARN] State fetcher not yet implemented — returning empty results\n");
  return [];
}
