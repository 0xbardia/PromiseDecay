import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GenlayerReader } from "../src/chain/reader.js";

/**
 * The readiness probe is the one place the API touches the chain on a hot path.
 *
 * It used to issue a raw, unmetered fetch, so anything polling /health/ready spent shared
 * quota the limiter could not see. These tests pin that it is now both budgeted and cached —
 * a poll loop must cost one request, not one per poll.
 */

const RPC = "https://rpc.invalid/api";

function makeReader(): GenlayerReader {
  return new GenlayerReader({
    rpcUrl: RPC,
    network: "studionet",
    address: "0x5F1C5C97ec9040FC76394419De3159C401bBDc05",
  });
}

function jsonRpcResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("GenlayerReader.ping", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports alive when the node answers with JSON-RPC", async () => {
    fetchMock.mockResolvedValue(jsonRpcResponse({ jsonrpc: "2.0", id: 1, result: null }));
    await expect(makeReader().ping()).resolves.toBe(true);
  });

  it("still reports alive when the node returns a JSON-RPC error", async () => {
    // A rate-limit or "unknown tx" error proves the node is up and speaking JSON-RPC. Treating
    // that as unhealthy would pull a perfectly good API out of rotation.
    fetchMock.mockResolvedValue(
      jsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { code: -32029, message: "rate limit" } })
    );
    await expect(makeReader().ping()).resolves.toBe(true);
  });

  it("caches the verdict instead of probing on every call", async () => {
    fetchMock.mockResolvedValue(jsonRpcResponse({ jsonrpc: "2.0", id: 1, result: null }));
    const reader = makeReader();

    await reader.ping();
    await reader.ping();
    await reader.ping();

    // One round trip for three readiness checks. Without the cache this was three unmetered
    // requests against a rate-limited endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-probes once the cache expires", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(jsonRpcResponse({ jsonrpc: "2.0", id: 1, result: null }));
      const reader = makeReader();

      await reader.ping();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(29_000);
      await reader.ping();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2_000); // past the TTL
      await reader.ping();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports unhealthy on a transport failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(makeReader().ping()).resolves.toBe(false);
  });

  it("reports unhealthy on a non-ok HTTP response", async () => {
    fetchMock.mockResolvedValue(jsonRpcResponse({ jsonrpc: "2.0" }, false));
    await expect(makeReader().ping()).resolves.toBe(false);
  });
});