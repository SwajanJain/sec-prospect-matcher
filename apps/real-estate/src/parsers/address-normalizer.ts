export interface NormalizedAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
  normalizedKey: string;
}

function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeAddress(raw: string | undefined): NormalizedAddress | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const segments = cleaned.split(",").map((value) => value.trim()).filter(Boolean);
  if (segments.length >= 3) {
    const line1 = normalizeToken(segments[0]);
    const city = normalizeToken(segments[1]);
    const stateZip = segments[2].trim().split(/\s+/);
    const state = normalizeToken(stateZip[0] ?? "");
    const zip = (stateZip[1] ?? "").trim();
    return {
      line1,
      city,
      state,
      zip,
      normalizedKey: [line1, city, state, zip].filter(Boolean).join("|"),
    };
  }

  const fallback = normalizeToken(cleaned);
  return {
    line1: fallback,
    city: "",
    state: "",
    zip: "",
    normalizedKey: fallback,
  };
}
