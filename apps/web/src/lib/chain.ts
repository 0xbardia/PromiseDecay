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

/** Chain descriptor. Built locally so chain metadata needs no SDK import. */
const GEN_CHAIN = {
  id: CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
};

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

  // genlayer-js drives the injected provider directly: the user's wallet signs, and the
  // server never holds a key.
  const { createClient } = await loadGenlayer();
  const genClient = createClient({
    chain: GEN_CHAIN as never,
    endpoint: RPC_URL,
    account: provider as never,
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