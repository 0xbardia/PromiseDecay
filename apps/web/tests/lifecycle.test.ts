import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeContract } = vi.hoisted(() => ({ writeContract: vi.fn() }));

vi.mock("../src/lib/chain", () => ({
  STAGE_COPY: {},
  STAGE_ORDER: [],
  UserRejectedError: class UserRejectedError extends Error {},
  WrongNetworkError: class WrongNetworkError extends Error {},
  explorerTxUrl: vi.fn(),
  writeContract,
}));

import { contractMethodFor, writeAction } from "../src/components/TransactionPanel";
import { lifecycleActions } from "../src/lib/lifecycle";

const base = {
  lifecycle: "OPEN",
  deadlineTs: 100,
  isFinal: false,
  delivery: null,
  integrity: null,
  challengeCount: 0,
  challengeClosesAt: null,
};

describe("public lifecycle transaction wiring", () => {
  beforeEach(() => writeContract.mockReset().mockResolvedValue({ hash: "0xabc", state: "FINALIZED" }));

  it.each([
    ["Request resolution", "request_resolution"],
    ["Challenge result", "challenge"],
    ["Re-evaluate result", "re_evaluate"],
    ["Finalize result", "finalize"],
  ])("dispatches %s to the contract method", async (action, method) => {
    await writeAction(action, ["7"]);

    expect(contractMethodFor(action)).toBe(method);
    expect(writeContract).toHaveBeenCalledWith({
      functionName: method,
      args: ["7"],
      onProgress: undefined,
    });
  });
});

describe("lifecycle action eligibility", () => {
  it("only enables resolution after the deadline", () => {
    expect(lifecycleActions(base, 99).requestResolution).toBe(false);
    expect(lifecycleActions(base, 100).requestResolution).toBe(true);
    expect(lifecycleActions({ ...base, lifecycle: "CHALLENGE_WINDOW" }, 100).requestResolution).toBe(false);
  });

  it("requires the matching challenge state and an open window", () => {
    const openWindow = {
      ...base,
      lifecycle: "CHALLENGE_WINDOW",
      delivery: "UNRESOLVED",
      integrity: "UNKNOWN",
      challengeClosesAt: 200,
    };
    expect(lifecycleActions(openWindow, 199).challenge).toBe(true);
    expect(lifecycleActions(openWindow, 200).challenge).toBe(false);
    expect(lifecycleActions({ ...openWindow, lifecycle: "RESOLVING" }, 199).challenge).toBe(false);
  });

  it("offers reevaluation after a challenge and finalization only after the window closes", () => {
    const resolving = {
      ...base,
      lifecycle: "RESOLVING",
      delivery: "UNRESOLVED",
      integrity: "UNKNOWN",
      challengeCount: 1,
      challengeClosesAt: 200,
    };
    expect(lifecycleActions(resolving, 199).reEvaluate).toBe(true);
    expect(lifecycleActions(resolving, 200).reEvaluate).toBe(true);
    expect(lifecycleActions({ ...resolving, lifecycle: "CHALLENGE_WINDOW" }, 199).finalize).toBe(false);
    expect(lifecycleActions({ ...resolving, lifecycle: "CHALLENGE_WINDOW" }, 200).finalize).toBe(true);
    expect(lifecycleActions({ ...resolving, lifecycle: "FINAL", isFinal: true }, 300)).toEqual({
      requestResolution: false,
      challenge: false,
      reEvaluate: false,
      finalize: false,
    });
  });

  it("hides challenge actions after the contract round limit", () => {
    const exhausted = {
      ...base,
      lifecycle: "CHALLENGE_WINDOW",
      delivery: "PARTIAL",
      integrity: "NARROWED",
      challengeCount: 3,
      challengeClosesAt: 200,
    };
    expect(lifecycleActions(exhausted, 199).challenge).toBe(false);
    expect(lifecycleActions(exhausted, 200).finalize).toBe(true);
  });
});
