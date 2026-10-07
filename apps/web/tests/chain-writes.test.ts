import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The stderr tail below is taken from the real failed request_resolution on the 1.0.1 production
// contract: the app sent the promise id as the string "2".
const REAL_FAILURE_STDERR =
  "Traceback (most recent call last):\n  File \"/contract.py\", line 734, in _require_promise\n" +
  "    if promise_id not in self.promises:\n" +
  "TypeError: '<' not supported between instances of 'str' and 'int'\n";

const tx = (executionResult: string, stderr = "") => ({
  status: "FINALIZED",
  consensus_data: { leader_receipt: [{ execution_result: executionResult, genvm_result: { stderr } }] },
});

describe("integer argument normalisation", () => {
  it.each(["add_evidence", "add_drift", "submit_response", "request_resolution", "challenge", "re_evaluate", "finalize"])(
    "sends the promise id to %s as an integer, not a string",
    async (method) => {
      const { normalizeWriteArgs } = await import("../src/lib/chain");
      const args = normalizeWriteArgs(method, ["2", "https://example.org/a", "quote"]);
      expect(args[0]).toBe(2n);
      expect(typeof args[0]).toBe("bigint");
      expect(args.slice(1)).toEqual(["https://example.org/a", "quote"]);
    }
  );

  it("sends create_promise's deadline as an integer and leaves the text fields alone", async () => {
    const { normalizeWriteArgs } = await import("../src/lib/chain");
    const args = normalizeWriteArgs("create_promise", ["p", "a", "q", "act", "obj", "scope", 1791333121, "c", "https://x.org"]);
    expect(args[6]).toBe(1791333121n);
    expect(args[0]).toBe("p");
    expect(args[8]).toBe("https://x.org");
  });

  it.each(["", "abc", "-1", "1.5", "0x10", "7; drop"])("refuses %j as a promise id", async (bad) => {
    const { normalizeWriteArgs } = await import("../src/lib/chain");
    expect(() => normalizeWriteArgs("finalize", [bad])).toThrow(/non-negative integer/);
  });
});

describe("reading the contract's execution result", () => {
  it("reports a contract error, with the reason, for a FINALIZED transaction", async () => {
    const { executionOutcome } = await import("../src/lib/chain");
    const outcome = executionOutcome(tx("ERROR", REAL_FAILURE_STDERR));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("TypeError");
  });

  it("reports success, and never success for a result it cannot read", async () => {
    const { executionOutcome } = await import("../src/lib/chain");
    expect(executionOutcome(tx("SUCCESS")).ok).toBe(true);
    expect(executionOutcome({ status: "FINALIZED" }).ok).toBeNull();
    expect(executionOutcome(null).ok).toBeNull();
  });
});

describe("writeContract never reports a failed execution as success", () => {
  const sent: unknown[][] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.resetModules();
    vi.stubEnv("VITE_GENLAYER_CONTRACT_ADDRESS", "0x742210deAab5d1A45F68675b1Ed0be2f621671c5");
    vi.doMock("genlayer-js", () => ({
      chains: { studionet: { id: 61999 } },
      createClient: () => ({
        writeContract: async (call: { args: unknown[] }) => {
          sent.push(call.args);
          return "0xabc";
        },
      }),
    }));
    (globalThis as { window?: unknown }).window = {
      ethereum: {
        request: async ({ method }: { method: string }) =>
          method === "eth_chainId" ? "0xf22f" : ["0x1111111111111111111111111111111111111111"],
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("genlayer-js");
    delete (globalThis as { window?: unknown }).window;
  });

  const stubRpc = (transaction: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body);
        const result = method === "gen_getTransactionStatus" ? "FINALIZED" : transaction;
        return { json: async () => ({ result }) };
      })
    );

  it("fails the write when the contract raised, even though the transaction is FINALIZED", async () => {
    stubRpc(tx("ERROR", REAL_FAILURE_STDERR));
    const { writeContract, ContractExecutionError } = await import("../src/lib/chain");
    const stages: string[] = [];

    await expect(
      writeContract({ functionName: "request_resolution", args: ["2"], onProgress: (p) => stages.push(p.stage) })
    ).rejects.toBeInstanceOf(ContractExecutionError);

    expect(stages.at(-1)).toBe("failed");
    expect(stages).not.toContain("final");
  });

  it("does not report success when the execution result cannot be verified", async () => {
    stubRpc({ status: "FINALIZED" });
    // The verifier retries a missing result a few times, three seconds apart; skip the waiting.
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never);
    const { writeContract } = await import("../src/lib/chain");
    const stages: string[] = [];

    await expect(
      writeContract({ functionName: "finalize", args: ["2"], onProgress: (p) => stages.push(p.stage) })
    ).rejects.toThrow(/could not be verified/);

    expect(stages.at(-1)).toBe("failed");
    expect(stages).not.toContain("final");
  });

  it("signs the promise id as an integer and reports final only after a successful execution", async () => {
    stubRpc(tx("SUCCESS"));
    const { writeContract } = await import("../src/lib/chain");
    const stages: string[] = [];

    const res = await writeContract({ functionName: "re_evaluate", args: ["2"], onProgress: (p) => stages.push(p.stage) });

    expect(res.hash).toBe("0xabc");
    expect(sent[0]?.[0]).toBe(2n);
    expect(stages.at(-1)).toBe("final");
  });
});
