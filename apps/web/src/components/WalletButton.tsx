/**
 * WalletButton.
 *
 * Connects an injected EIP-1193 wallet. There is no bundled signing key of any kind: the
 * user approves every write in their own wallet. WalletConnect is intentionally not
 * enabled with a placeholder project id — see docs/DEPLOYMENT.md for how to add one.
 */
import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, NETWORK_NAME, connect, currentAccount, currentChainId, getInjectedProvider } from "../lib/chain";
import { shortAddress } from "@promisedecay/domain";

export function WalletButton() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);

  // Reflect an already-connected wallet on load, and follow account/network changes so
  // the UI stays truthful if the user switches networks mid-session.
  useEffect(() => {
    const provider = getInjectedProvider();
    setHasProvider(Boolean(provider));
    if (!provider) return;

    void currentAccount(provider).then(setAccount);
    void currentChainId(provider).then(setChainId).catch(() => undefined);

    const onAccounts = (accounts: string[]) => setAccount(accounts[0] ?? null);
    const onChain = (hex: string) => setChainId(Number.parseInt(hex, 16));

    provider.on?.("accountsChanged", onAccounts as never);
    provider.on?.("chainChanged", onChain as never);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts as never);
      provider.removeListener?.("chainChanged", onChain as never);
    };
  }, []);

  const onConnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const accounts = await connect();
      setAccount(accounts[0] ?? null);
      const provider = getInjectedProvider();
      if (provider) setChainId(await currentChainId(provider));
    } catch (err) {
      setError(
        /reject|denied/i.test(String((err as Error).message))
          ? "Connection declined."
          : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (account) {
    const wrongNetwork = chainId !== null && chainId !== CHAIN_ID;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {wrongNetwork ? (
          <span
            className="pd-chip"
            style={{ ["--chip-color" as string]: "var(--amber)" }}
            title={`Your wallet is on chain ${chainId}; PromiseDecay is on chain ${CHAIN_ID}`}
            data-testid="wallet-wrong-network"
          >
            <span className="pd-chip__dot" aria-hidden="true" />
            Wrong network
          </span>
        ) : null}
        <button
          type="button"
          className="pd-btn pd-btn--secondary pd-btn--sm"
          onClick={() => setAccount(null)}
          title="Disconnect this site (the wallet keeps its own state)"
          data-testid="wallet-connected"
        >
          {shortAddress(account)}
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {error ? (
        <span className="pd-error" role="alert" style={{ fontSize: "0.8rem" }}>
          {error}
        </span>
      ) : null}
      <button
        type="button"
        className="pd-btn pd-btn--secondary pd-btn--sm"
        onClick={() => void onConnect()}
        disabled={busy}
        title={
          hasProvider
            ? `Connect your wallet to sign writes on ${NETWORK_NAME}`
            : "No injected wallet detected. Install a browser wallet to sign writes."
        }
        data-testid="wallet-connect"
      >
        {hasProvider ? (busy ? "Connecting…" : "Connect Wallet") : "Connect Wallet"}
      </button>
    </span>
  );
}