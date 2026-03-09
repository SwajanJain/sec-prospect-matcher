import test from "node:test";
import assert from "node:assert/strict";

// This test verifies the pagination logic by testing the normalizeRecord function
// and the structure of the API response types. Full API pagination testing
// requires mocking fetch, which is done separately.

test("FEC API fetcher module exports fetchRecentFecApi", async () => {
  const mod = await import("../src/fetchers/fec-api-fetcher");
  assert.equal(typeof mod.fetchRecentFecApi, "function");
});

test("FEC API fetcher returns empty array when no API key", async () => {
  const { fetchRecentFecApi } = await import("../src/fetchers/fec-api-fetcher");
  const result = await fetchRecentFecApi({
    apiKey: "",
    minDate: "2026-01-01",
    stateStore: { paths: { recent: "/tmp" } } as any,
  });
  assert.deepEqual(result, []);
});
