import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock("genlayer-js");
  vi.resetModules();
});

it("ends a stalled contract read so the page can offer retry", async () => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_GENLAYER_CONTRACT_ADDRESS", "0x742210deAab5d1A45F68675b1Ed0be2f621671c5");
  vi.doMock("genlayer-js", () => ({
    chains: { studionet: { id: 61999 } },
    createClient: () => ({ readContract: () => new Promise(() => undefined) }),
  }));

  const { readPromiseContractState } = await import("../src/lib/chain");
  const read = readPromiseContractState("2");
  const timedOut = expect(read).rejects.toThrow("GenLayer contract read timed out.");
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
});
