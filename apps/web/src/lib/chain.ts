/**
 * Wallet + chain write layer.
 *
 * Every production write is signed by the user's own browser wallet through an EIP-1193
 * provider. There is no server signer, no stored key, and no path in this file that marks
 * a transaction final without asking the chain.
 *
 * The transaction state machine the UI renders:
 *   idle → awaiting-wallet → submitted → consensus → accepted → final
 *                                  ↘ failed
 */
import type { EIP1193Provider } from "viem";
import type { ApiPromiseDetail } from "./api";

/**
 * genlayer-js and viem are loaded on demand.
 *
 * They are only needed when a user signs a write. Eagerly importing them added ~400kB to
 * every page — including the landing page, where most visitors never connect a wallet.
 */
type GenlayerModule = typeof import("genlayer-js");

let genlayer: GenlayerModule | null = null;
async function loadGenlayer(): Promise<GenlayerModule> {
  if (!genlayer) {
    genlayer = await import("genlayer-js");
  }
  return genlayer;
}

const RPC_URL =
  (import.meta.env.VITE_GENLAYER_RPC_URL as string | undefined) ??
  "https://studio.genlayer.com/api";

const CHAIN_ID = Number(import.meta.env.VITE_GENLAYER_CHAIN_ID ?? 61999);

const NETWORK_NAME =
  (import.meta.env.VITE_GENLAYER_NETWORK as string | undefined) ?? "studionet";

export const CONTRACT_ADDRESS = (import.meta.env.VITE_GENLAYER_CONTRACT_ADDRESS as
  | string
  | undefined) ?? null;

/**
 * Resolve genlayer-js's own chain descriptor for the configured chain id.
 *
 * The SDK's descriptor is used rather than one built by hand. genlayer-js dereferences
 * `chainId`, `gasPrice` and the RPC transport while constructing a write, and a hand-rolled
 * object that looked equivalent was missing them — so every write died client-side with
 * `Cannot convert undefined to a BigInt` before a single request was sent. Failing loudly when
 * the configured id has no descriptor is the correct alternative to silently guessing.
 */
function chainDescriptor(chains: Record<string, unknown>) {
  const match = Object.values(chains).find(
    (c) => (c as { id?: number })?.id === CHAIN_ID
  );
  if (!match) {
    throw new Error(
      `GenLayer SDK has no chain with id ${CHAIN_ID}. Check GENLAYER_CHAIN_ID in the environment.`
    );
  }
  return match as never;
}

/** Terminal-ish states reported by GenLayer. */
export const TERMINAL_STATES = new Set(["FINALIZED", "REVERTED", "UNDERCATED", "GENESIS"]);

export type TxStage =
  | "idle"
  | "awaiting-wallet"
  | "submitted"
  | "consensus"
  | "accepted"
  | "final"
  | "failed";

export interface TxProgress {
  stage: TxStage;
  hash: string | null;
  message: string;
}

export const STAGE_ORDER: TxStage[] = [
  "awaiting-wallet",
  "submitted",
  "consensus",
  "accepted",
  "final",
];

/** Copy for each stage, so the UI never invents its own wording. */
export const STAGE_COPY: Record<TxStage, string> = {
  idle: "Ready.",
  "awaiting-wallet": "Waiting for your wallet to sign.",
  submitted: "Transaction submitted to the network.",
  consensus: "Validators are evaluating this transaction.",
  accepted: "Accepted. Waiting for finalization.",
  final: "Finalized on chain.",
  failed: "Failed.",
};

export class UserRejectedError extends Error {
  constructor() {
    super("You rejected the signature in your wallet.");
    this.name = "UserRejectedError";
  }
}

export class WrongNetworkError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Your wallet is on chain ${actual}, but PromiseDecay is deployed on chain ${expected}. ` +
        `Switch your wallet to the GenLayer network and try again.`
    );
    this.name = "WrongNetworkError";
  }
}

/** Extract an injected EIP-1193 provider without pulling in a wallet SDK. */
export function getInjectedProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

/**
 * Adapt an injected provider into the account shape genlayer-js expects.
 *
 * Three separate mistakes lived in this one adapter, and each produced a total write failure
 * with a misleading message. They are documented together because the symptoms looked like
 * wallet problems rather than wiring problems.
 *
 * 1. **The address.** genlayer-js reads `account.address`; an EIP-1193 provider exposes
 *    `selectedAddress` instead. Handing it the raw provider left the address `undefined` and
 *    every write died with viem's `Address "undefined" is invalid` before any request.
 *
 * 2. **The chain descriptor.** A hand-rolled descriptor looked equivalent but lacked the
 *    fields the SDK dereferences (`chainId`, `gasPrice`), so writes failed with
 *    `Cannot convert undefined to a BigInt`. The SDK's own descriptor is used instead.
 *
 * 3. **`type`.** genlayer-js branches on it: a `"local"` account is signed via
 *    `account.signTransaction` and the signature is broadcast with `sendRawTransaction`;
 *    anything else makes the SDK call `eth_sendTransaction` on the *node*, which does not
 *    implement it. So a browser wallet must be presented as `type: "local"` and asked to sign
 *    with `eth_signTransaction` — the signature then goes to the node, which is exactly the
 *    split of responsibility the design intends.
 *
 * No key material exists in this file: the wallet signs, the node broadcasts, the server never
 * sees either.
 */
function walletAccount(provider: EIP1193Provider, address: string) {
  return {
    address,
    // Must be "local" — see (3) above.
    type: "local" as const,
    async signTransaction(tx: {
      to?: string;
      data?: string;
      value?: bigint;
      gas?: bigint;
      gasPrice?: bigint;
      nonce?: number;
      chainId?: number;
    }): Promise<string> {
      const hex = (v: bigint | number | undefined) =>
        v === undefined ? undefined : `0x${v.toString(16)}`;

      const payload = {
        from: address,
        to: tx.to,
        data: tx.data,
        value: hex(tx.value ?? 0n),
        gas: hex(tx.gas ?? 200_000n),
        gasPrice: hex(tx.gasPrice),
        nonce: tx.nonce === undefined ? undefined : hex(tx.nonce),
        chainId: hex(tx.chainId ?? CHAIN_ID),
      };

      // One narrow cast, at the one boundary where it is genuinely needed: viem types
      // `request` against its own RpcRequest union, which does not include this
      // eth_signTransaction shape. The payload above is the real, complete transaction and
      // the wallet validates it on its side.
      const signed = (await provider.request({
        method: "eth_signTransaction",
        params: [payload],
      } as never)) as string;
      return signed;
    },
  };
}

export async function connect(): Promise<string[]> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      "No injected wallet found. Install a browser wallet, or add a wallet provider to this page."
    );
  }
  return await provider.request({ method: "eth_requestAccounts" });
}

export async function currentAccount(provider: EIP1193Provider): Promise<string | null> {
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  return accounts[0] ?? null;
}

export async function currentChainId(provider: EIP1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

interface WriteOptions {
  functionName: string;
  args: unknown[];
  onProgress?: (p: TxProgress) => void;
  signal?: AbortSignal;
}

/**
 * Sign and submit a contract write, then follow it to a terminal state.
 *
 * Progress is reported at every stage so the UI can show real transaction state rather
 * than an optimistic guess.
 */
export async function writeContract(opts: WriteOptions): Promise<{ hash: string; state: string }> {
  const { functionName, args, onProgress, signal } = opts;
  const report = (p: TxProgress) => onProgress?.(p);

  const provider = getInjectedProvider();
  if (!provider) {
    report({ stage: "failed", hash: null, message: "No injected wallet found." });
    throw new Error("No injected wallet found.");
  }
  if (!CONTRACT_ADDRESS) {
    report({
      stage: "failed",
      hash: null,
      message: "Contract address is not configured for this deployment.",
    });
    throw new Error("Contract address is not configured.");
  }

  const chainId = await currentChainId(provider);
  if (chainId !== CHAIN_ID) {
    const err = new WrongNetworkError(CHAIN_ID, chainId);
    report({ stage: "failed", hash: null, message: err.message });
    throw err;
  }

  report({ stage: "awaiting-wallet", hash: null, message: STAGE_COPY["awaiting-wallet"] });

  // The user's own wallet signs. The server never holds a key.
  const accounts = await currentAccount(provider);
  if (!accounts) throw new Error("Wallet is not connected.");

  const { createClient, chains } = await loadGenlayer();
  const genClient = createClient({
    chain: chainDescriptor(chains as never),
    endpoint: RPC_URL,
    account: walletAccount(provider, accounts) as never,
  });

  let hash: string;
  try {
    hash = await genClient.writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName,
      args: args as never,
      // No GEN is transferred by any PromiseDecay write; value is required by the SDK.
      value: 0n,
    });
  } catch (err) {
    const message = String((err as Error).message ?? err);
    // Wallet rejection has several vendor-specific shapes; treat them all as a
    // recoverable, user-caused outcome rather than a hard failure.
    const rejected =
      /user rejected|rejected the request|denied|UserError|rejected/i.test(message) ||
      (err as { code?: number }).code === 4001;
    if (rejected) {
      const rej = new UserRejectedError();
      report({ stage: "failed", hash: null, message: rej.message });
      throw rej;
    }
    report({ stage: "failed", hash: null, message });
    throw err;
  }

  report({ stage: "submitted", hash, message: STAGE_COPY.submitted });

  const poll = async (): Promise<string> => {
    for (;;) {
      if (signal?.aborted) throw new Error("aborted");
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "gen_getTransactionStatus",
          params: [hash],
        }),
        signal,
      });
      const body = (await res.json()) as { result?: string; error?: { message?: string } };
      if (body.error?.message) throw new Error(body.error.message);
      const state = body.result ?? "";
      report({ stage: stageFor(state), hash, message: STAGE_COPY[stageFor(state)] });
      if (TERMINAL_STATES.has(state)) return state;
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  const state = await poll();
  if (state !== "FINALIZED") {
    report({ stage: "failed", hash, message: `Transaction ended as ${state}.` });
    throw new Error(`Transaction ended as ${state}.`);
  }
  report({ stage: "final", hash, message: STAGE_COPY.final });
  return { hash, state };
}

/** Read the full current promise state after a confirmed write, bypassing indexer lag. */
export async function readPromiseContractState(id: string): Promise<Partial<ApiPromiseDetail>> {
  if (!CONTRACT_ADDRESS) throw new Error("Contract address is not configured.");
  const { createClient, chains } = await loadGenlayer();
  const client = createClient({ chain: chainDescriptor(chains as never), endpoint: RPC_URL });
  const read = async <T,>(functionName: string, args: unknown[] = []): Promise<T> =>
    (await client.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName,
      args: args as never,
    })) as unknown as T;
  const parse = <T,>(raw: unknown): T =>
    (typeof raw === "string" ? JSON.parse(raw) : raw) as T;

  const lifecycle = await read<string>("get_lifecycle_status", [id]);
  const hasResult = ["RESOLVING", "PROVISIONAL", "CHALLENGE_WINDOW", "FINAL"].includes(lifecycle);
  const [evidenceRaw, driftRaw, responsesRaw, challengesRaw, window] = await Promise.all([
    read<string | unknown[]>("get_evidence", [id]),
    read<string | unknown[]>("get_drift", [id]),
    read<string | unknown[]>("get_responses", [id]),
    read<string | unknown[]>("get_challenges", [id]),
    read<{ challenge_closes_at: string }>("get_challenge_window", [id]),
  ]);
  const result = hasResult
    ? await read<Record<string, unknown>>(
        lifecycle === "FINAL" ? "get_final_result" : "get_provisional_result",
        [id]
      )
    : null;
  const evidence = parse<Array<Record<string, unknown>>>(evidenceRaw);
  const drift = parse<Array<Record<string, unknown>>>(driftRaw);
  const responses = parse<Array<Record<string, unknown>>>(responsesRaw);
  const challenges = parse<Array<Record<string, unknown>>>(challengesRaw);

  return {
    lifecycle,
    delivery: (result?.delivery as ApiPromiseDetail["delivery"]) ?? null,
    integrity: (result?.integrity as ApiPromiseDetail["integrity"]) ?? null,
    deadlineMet: (result?.deadline_met as boolean | undefined) ?? null,
    materialScopeChange: (result?.material_scope_change as boolean | undefined) ?? null,
    explanation: (result?.explanation as string | undefined) ?? null,
    decidedTs: result ? Number(result.decided_ts) : null,
    isFinal: lifecycle === "FINAL",
    challengeCount: challenges.length,
    evidenceCount: evidence.length,
    driftCount: drift.length,
    responseCount: responses.length,
    challengeClosesAt: Number(window.challenge_closes_at) || null,
    evidence: evidence.map((item) => ({
      submitter: String(item.submitter),
      sourceUrl: String(item.source_url),
      quote: String(item.quote),
      kind: String(item.kind),
      submittedTs: Number(item.submitted_ts),
    })),
    drift: drift.map((item) => ({
      submitter: String(item.submitter),
      statement: String(item.statement),
      sourceUrl: String(item.source_url),
      submittedTs: Number(item.submitted_ts),
      relationship: String(item.relationship),
    })),
    responses: responses.map((item) => ({
      submitter: String(item.submitter),
      statement: String(item.statement),
      sourceUrl: String(item.source_url),
      submittedTs: Number(item.submitted_ts),
      verified: Boolean(item.verified),
    })),
    challenges: challenges.map((item) => ({
      challenger: String(item.challenger),
      reason: String(item.reason),
      evidenceUrl: String(item.evidence_url),
      submittedTs: Number(item.submitted_ts),
    })),
  };
}

function stageFor(state: string): TxStage {
  switch (state) {
    case "PENDING":
    case "PROPOSING":
      return "consensus";
    case "COMMITTING":
    case "ACCEPTED":
    case "UNDERCOMMIT":
      return "accepted";
    case "FINALIZED":
      return "final";
    case "REVERTED":
    case "UNDERCATED":
    case "GENESIS":
      return "failed";
    default:
      return "consensus";
  }
}

/** Deep-linkable explorer URL for a transaction. */
export function explorerTxUrl(hash: string): string {
  return `https://explorer-studio.genlayer.com/tx/${hash}`;
}

export { RPC_URL, CHAIN_ID, NETWORK_NAME };
