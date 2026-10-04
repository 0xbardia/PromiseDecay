import { describe, expect, it } from "vitest";
import { dailySpend, intervalFor, readsPerPass } from "../src/pacing.js";

/**
 * The indexer's pacing is the difference between a working deployment and one that silently
 * exhausts a shared quota. These tests exist because getting it wrong does not crash anything:
 * the worker keeps requesting, the endpoint starts refusing, and the symptom looks like an
 * outage somewhere else.
 */

const BUDGET = 2_500;
const MIN = 600_000; // 10 minutes

describe("readsPerPass", () => {
  it("counts one id read plus nine per promise", () => {
    expect(readsPerPass(1)).toBe(10);
    expect(readsPerPass(4)).toBe(37);
    expect(readsPerPass(100)).toBe(901);
  });

  it("treats an empty chain as one promise, never zero", () => {
    // Zero would make the interval infinite and the indexer would stop syncing a brand new
    // deployment forever.
    expect(readsPerPass(0)).toBe(10);
    expect(readsPerPass(-5)).toBe(10);
  });
});

describe("intervalFor", () => {
  it("keeps a day's spend inside the budget while a pass is affordable", () => {
    // A pass costs 1 + 9 × promises. The interval can hold the budget for any dataset whose
    // single pass already fits inside it.
    for (const n of [0, 1, 4, 25, 100, 250]) {
      expect(
        readsPerPass(n),
        `${n} promises: a pass must be affordable before the interval means anything`
      ).toBeLessThanOrEqual(BUDGET);
      expect(
        dailySpend(n, BUDGET, MIN),
        `${n} promises should stay within ${BUDGET} requests/day`
      ).toBeLessThanOrEqual(BUDGET);
    }
  });

  it("cannot hold the budget once one pass exceeds it", () => {
    // Documented limitation, pinned deliberately.
    //
    // At ~278 promises a single pass costs more than the entire daily budget, so no interval
    // can satisfy both "sync once a day" and "stay inside the budget" — the indexer would have
    // to pick one. It currently picks correctness of freshness and overshoots.
    //
    // The real fix is architectural, not arithmetic: a full re-sync per pass is the wrong
    // shape. Reads should be incremental — a cheap per-promise change signal, then only the
    // promises that actually moved get their nine reads. That makes a pass cost proportional
    // to what changed rather than to the size of the dataset, and this limitation disappears.
    //
    // Until that exists, this test is the canary: when it is changed to assert the budget is
    // held at 500 promises, the incremental reader has landed and the arithmetic can go with it.
    const overshoot = readsPerPass(500);
    expect(overshoot).toBeGreaterThan(BUDGET);
    expect(dailySpend(500, BUDGET, MIN)).toBeGreaterThan(BUDGET);
  });

  it("slows down as the dataset grows", () => {
    const few = intervalFor(4, BUDGET, MIN);
    const many = intervalFor(400, BUDGET, MIN);
    expect(many).toBeGreaterThan(few);
  });

  it("respects the floor however aggressive the budget is", () => {
    // A large budget must not turn the indexer into a request flood.
    expect(intervalFor(4, 10_000_000, MIN)).toBe(MIN);
  });

  it("still syncs once a day when the budget cannot afford a pass", () => {
    // 500k promises costs 4.5M reads per pass. The budget cannot buy a pass, but the product
    // must still track the chain, so one pass a day is the floor rather than never.
    const interval = intervalFor(500_000, 1_000, MIN);
    expect(interval).toBe(86_400_000);
  });

  it("never returns a non-positive interval", () => {
    expect(intervalFor(1, 0, MIN)).toBeGreaterThan(0);
    expect(intervalFor(1, -100, MIN)).toBeGreaterThan(0);
  });

  it("produces a sane cadence for the current deployment", () => {
    // Four promises against a 2,500/day budget lands near 21 minutes. Pinned because this
    // number is what the log reports and what an operator will judge the deployment by.
    const minutes = intervalFor(4, BUDGET, MIN) / 60_000;
    expect(minutes).toBeGreaterThan(10);
    expect(minutes).toBeLessThan(60);
  });
});