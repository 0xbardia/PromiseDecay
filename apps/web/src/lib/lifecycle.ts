import { BOUNDS } from "@promisedecay/domain";

export interface LifecycleState {
  lifecycle: string;
  deadlineTs: number;
  isFinal: boolean;
  delivery: string | null;
  integrity: string | null;
  challengeCount: number;
  challengeClosesAt: number | null;
}

export function lifecycleActions(state: LifecycleState, now = Math.floor(Date.now() / 1000)) {
  const hasResult = Boolean(state.delivery && state.integrity);
  const windowOpen = state.challengeClosesAt !== null && now < state.challengeClosesAt;
  const windowClosed = state.challengeClosesAt !== null && now >= state.challengeClosesAt;

  return {
    requestResolution:
      !state.isFinal &&
      !hasResult &&
      ["OPEN", "DUE"].includes(state.lifecycle) &&
      now >= state.deadlineTs,
    challenge:
      !state.isFinal &&
      hasResult &&
      state.lifecycle === "CHALLENGE_WINDOW" &&
      windowOpen &&
      state.challengeCount < BOUNDS.MAX_CHALLENGE_ROUNDS,
    reEvaluate:
      !state.isFinal &&
      hasResult &&
      state.lifecycle === "RESOLVING" &&
      state.challengeCount > 0 &&
      state.challengeCount <= BOUNDS.MAX_CHALLENGE_ROUNDS,
    finalize:
      !state.isFinal &&
      hasResult &&
      state.lifecycle === "CHALLENGE_WINDOW" &&
      windowClosed,
  };
}
