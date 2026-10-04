/**
 * /promises/:id/evidence | /update | /respond | /challenge
 *
 * One page serving the four write flows. Each mode explains what it will do, validates
 * against the same rules as the contract, and routes the write through the wallet-signed
 * transaction panel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BOUNDS, URL_REJECTION_MESSAGE, checkSourceUrl, promiseRef } from "@promisedecay/domain";
import { EmptyState, GlassSurface, Notice, StatusChip } from "../components/primitives";
import { TransactionPanel } from "../components/TransactionPanel";
import { api, type ApiPromiseDetail } from "../lib/api";
import { connect, currentChainId } from "../lib/chain";

type Mode = "evidence" | "update" | "respond" | "challenge";

const MODE_CONFIG: Record<
  Mode,
  {
    title: string;
    lede: string;
    action: string;
    cta: string;
    fields: Array<{
      key: string;
      label: string;
      hint: string;
      kind: "url" | "text" | "longtext" | "select";
      options?: string[];
      required: boolean;
      minLength?: number;
    }>;
    note: string;
  }
> = {
  evidence: {
    title: "Add evidence",
    lede: "Point at something anyone can open and check. Evidence is stored permanently and linked to this promise.",
    action: "Add evidence",
    cta: "Sign and add this evidence",
    note: "Exact duplicates are rejected, so the same source and quote cannot be added twice.",
    fields: [
      {
        key: "sourceUrl",
        label: "Source URL",
        hint: "The page that shows what was delivered.",
        kind: "url",
        required: true,
      },
      {
        key: "quote",
        label: "Quoted evidence",
        hint: "The relevant passage, quoted exactly.",
        kind: "longtext",
        required: true,
        minLength: 4,
      },
      {
        key: "kind",
        label: "Evidence type",
        hint: "What this source is.",
        kind: "select",
        options: ["SOURCE", "ARTIFACT", "STATEMENT", "ABSENCE"],
        required: true,
      },
    ],
  },
  update: {
    title: "Add a later statement",
    lede: "Attach a later statement about this promise. The original is never modified — this becomes the next step in the lineage.",
    action: "Add later statement",
    cta: "Sign and add this statement",
    note: "PromiseDecay classifies how this statement changed the wording, scope or intent.",
    fields: [
      {
        key: "statement",
        label: "The later statement",
        hint: "Quote it exactly as stated.",
        kind: "longtext",
        required: true,
        minLength: 8,
      },
      {
        key: "sourceUrl",
        label: "Source URL",
        hint: "Where this statement was published.",
        kind: "url",
        required: true,
      },
    ],
  },
  respond: {
    title: "Submit a response",
    lede: "Anyone may respond. A response is a separate, permanent record — it never rewrites the promise or the verdict.",
    action: "Submit response",
    cta: "Sign and submit this response",
    note: "Your response will be shown as “Response from 0x…”. It is only labelled as an official project response when ownership has been verified.",
    fields: [
      {
        key: "statement",
        label: "Your response",
        hint: "Say what you want on the record.",
        kind: "longtext",
        required: true,
        minLength: 4,
      },
      {
        key: "sourceUrl",
        label: "Source URL",
        hint: "An optional link supporting your response.",
        kind: "url",
        required: true,
      },
    ],
  },
  challenge: {
    title: "Challenge this result",
    lede: "A provisional result stays open for a bounded window. A challenge must bring materially new evidence and triggers real re-evaluation.",
    action: "Challenge result",
    cta: "Sign and submit this challenge",
    note: "The challenge must cite a source not already used as evidence, and your reason must explain what the verdict missed.",
    fields: [
      {
        key: "reason",
        label: "What does the verdict miss?",
        hint: "Explain what materially new evidence shows.",
        kind: "longtext",
        required: true,
        minLength: 12,
      },
      {
        key: "sourceUrl",
        label: "New evidence URL",
        hint: "Must not already be evidence on this promise.",
        kind: "url",
        required: true,
      },
    ],
  },
};

function modeFromPath(pathname: string): Mode | null {
  if (pathname.endsWith("/evidence")) return "evidence";
  if (pathname.endsWith("/update")) return "update";
  if (pathname.endsWith("/respond")) return "respond";
  if (pathname.endsWith("/challenge")) return "challenge";
  return null;
}

export function PromiseAction({
  params,
  pathname,
}: {
  params: Record<string, string>;
  pathname: string;
}) {
  const id = params.id ?? "";
  const mode = modeFromPath(pathname);
  const config = mode ? MODE_CONFIG[mode] : null;

  const [promise, setPromise] = useState<ApiPromiseDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!/^\d+$/.test(id)) return;
    api.getPromise(id).then(setPromise).catch(() => setPromise(null));
  }, [id]);

  useEffect(load, [load]);

  const errors = useMemo(() => {
    if (!config) return {} as Record<string, string>;
    const e: Record<string, string> = {};
    for (const field of config.fields) {
      const raw = values[field.key] ?? "";
      const value = raw.trim();
      if (field.required && value.length === 0) {
        e[field.key] = `${field.label} is required.`;
        continue;
      }
      if (field.kind === "url" && value.length > 0) {
        const check = checkSourceUrl(value);
        if (!check.ok) e[field.key] = URL_REJECTION_MESSAGE[check.reason];
      }
      if ((field.kind === "text" || field.kind === "longtext") && value.length > 0) {
        if (field.minLength && value.length < field.minLength) {
          e[field.key] = `Use at least ${field.minLength} characters so this is meaningful.`;
        } else if (value.length > BOUNDS.MAX_QUOTE) {
          e[field.key] = `Keep this under ${BOUNDS.MAX_QUOTE} characters.`;
        }
      }
      if (field.kind === "select" && value && !field.options?.includes(value)) {
        e[field.key] = "Choose one of the listed options.";
      }
    }
    // A challenge must not cite evidence already on record.
    if (mode === "challenge" && promise && values.sourceUrl) {
      const dupe = promise.evidence.some(
        (e) => e.sourceUrl.toLowerCase() === values.sourceUrl!.trim().toLowerCase()
      );
      if (dupe) e.sourceUrl = "That source is already evidence on this promise. A challenge needs new material.";
    }
    return e;
  }, [config, values, mode, promise]);

  if (!mode || !config) {
    return (
      <section className="pd-section">
        <div className="pd-shell">
          <EmptyState title="Unknown action" body="That promise action does not exist." icon="◌" />
        </div>
      </section>
    );
  }

  if (!/^\d+$/.test(id)) {
    return (
      <section className="pd-section">
        <div className="pd-shell">
          <EmptyState
            title="Invalid promise id"
            body="A promise id is a positive integer, like pd-1."
            icon="◌"
            action={
              <a className="pd-btn pd-btn--primary" href="/explore">
                Explore promises
              </a>
            }
          />
        </div>
      </section>
    );
  }

  const valid = Object.keys(errors).length === 0;

  const onConnect = async () => {
    setWalletError(null);
    try {
      const accounts = await connect();
      setAccount(accounts[0] ?? null);
      const provider = (window as { ethereum?: Parameters<typeof currentChainId>[0] }).ethereum;
      if (provider) {
        const chain = await currentChainId(provider);
        if (chain !== 61999) {
          setWalletError(
            `Your wallet is on chain ${chain}. Switch to GenLayer chain 61999 to continue.`
          );
        }
      }
    } catch (err) {
      setWalletError(
        /reject/i.test(String((err as Error).message))
          ? "You declined the connection request."
          : (err as Error).message
      );
    }
  };

  const buildArgs = (): unknown[] => {
    const v = (k: string) => (values[k] ?? "").trim();
    switch (mode) {
      case "evidence":
        return [id, v("sourceUrl"), v("quote"), v("kind")];
      case "update":
        return [id, v("statement"), v("sourceUrl")];
      case "respond":
        return [id, v("statement"), v("sourceUrl")];
      default:
        return [id, v("reason"), v("sourceUrl")];
    }
  };

  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
      <div className="pd-shell" style={{ maxWidth: 780 }}>
        <nav aria-label="Breadcrumb" className="pd-mono pd-dim" style={{ marginBottom: 18, fontSize: "0.8rem" }}>
          <a href="/explore" style={{ color: "var(--sky)" }}>
            promises
          </a>
          <span aria-hidden="true"> / </span>
          <a href={`/promises/${id}`} style={{ color: "var(--sky)" }}>
            {promiseRef(id)}
          </a>
        </nav>

        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: "clamp(1.8rem, 3.6vw, 2.6rem)", marginBottom: 12 }}>
            {config.title}
          </h1>
          <p className="pd-muted" style={{ fontSize: "1.02rem", lineHeight: 1.6 }}>
            {config.lede}
          </p>
        </header>

        {/* Context: what you are acting on, and its current state. */}
        {promise ? (
          <GlassSurface tone="flat" className="pd-glass__pad" style={{ padding: 18, marginBottom: 20 }}>
            <div className="pd-row pd-wrap" style={{ gap: 12, justifyContent: "space-between" }}>
              <div className="pd-grow" style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 620, fontSize: "0.92rem" }}>{promise.project}</div>
                <p
                  className="pd-muted"
                  style={{ fontSize: "0.92rem", marginTop: 5, lineHeight: 1.5 }}
                >
                  “{promise.originalQuote.slice(0, 150)}
                  {promise.originalQuote.length > 150 ? "…" : ""}”
                </p>
              </div>
              <div className="pd-row pd-wrap" style={{ gap: 7 }}>
                {promise.delivery ? (
                  <StatusChip value={promise.delivery} kind="delivery" />
                ) : null}
                {promise.integrity ? (
                  <StatusChip value={promise.integrity} kind="integrity" />
                ) : null}
                <StatusChip value={promise.lifecycle} kind="lifecycle" />
              </div>
            </div>
          </GlassSurface>
        ) : (
          <div className="pd-skeleton" style={{ height: 88, marginBottom: 20 }} />
        )}

        <Notice tone="info" title={mode === "challenge" ? "Challenges are permanent" : "This is permanent"}>
          {config.note}
        </Notice>

        {mode === "challenge" && promise?.isFinal ? (
          <div style={{ marginTop: 16 }}>
            <Notice tone="warn" title="This promise is already final">
              A final resolution cannot be challenged. The challenge window has closed.
            </Notice>
          </div>
        ) : null}

        <form
          className="pd-stack"
          style={{ gap: 18, marginTop: 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
          }}
        >
          <GlassSurface tone="heavy" className="pd-glass__pad">
            <div className="pd-stack" style={{ gap: 20 }}>
              {config.fields.map((field) => {
                const value = values[field.key] ?? "";
                const error = touched ? errors[field.key] : undefined;
                const idAttr = `field-${field.key}`;
                return (
                  <div className="pd-field" key={field.key}>
                    <label className="pd-label" htmlFor={idAttr}>
                      {field.label}
                    </label>
                    {field.kind === "select" ? (
                      <select
                        id={idAttr}
                        className="pd-select"
                        value={value || field.options?.[0] || ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [field.key]: e.target.value }))
                        }
                        aria-invalid={Boolean(error)}
                      >
                        {field.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : field.kind === "longtext" ? (
                      <textarea
                        id={idAttr}
                        className="pd-textarea"
                        value={value}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                        aria-invalid={Boolean(error)}
                        aria-describedby={`${idAttr}-hint`}
                        rows={field.key === "quote" || field.key === "statement" ? 4 : 3}
                        data-testid={`field-${field.key}`}
                      />
                    ) : (
                      <input
                        id={idAttr}
                        className="pd-input"
                        type={field.kind === "url" ? "url" : "text"}
                        value={value}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                        aria-invalid={Boolean(error)}
                        aria-describedby={`${idAttr}-hint`}
                        data-testid={`field-${field.key}`}
                      />
                    )}
                    <div className="pd-row" style={{ gap: 10, alignItems: "baseline" }}>
                      <span className="pd-hint" id={`${idAttr}-hint`}>
                        {field.hint}
                      </span>
                      {field.kind === "longtext" ? (
                        <span
                          className={
                            value.length > BOUNDS.MAX_QUOTE
                              ? "pd-counter pd-counter--over"
                              : "pd-counter"
                          }
                          style={{ marginLeft: "auto", flexShrink: 0 }}
                        >
                          {value.length}/{BOUNDS.MAX_QUOTE}
                        </span>
                      ) : null}
                    </div>
                    {error ? (
                      <p className="pd-error" role="alert">
                        <span aria-hidden="true">⚠</span>
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </GlassSurface>

          <GlassSurface className="pd-glass__pad">
            <div className="pd-row pd-wrap" style={{ gap: 16, justifyContent: "space-between" }}>
              <div className="pd-grow" style={{ minWidth: 240 }}>
                <p style={{ fontWeight: 640, marginBottom: 5 }}>Signing with your wallet</p>
                <p className="pd-hint">
                  {account
                    ? `Connected as ${account.slice(0, 6)}…${account.slice(-4)}.`
                    : "Your wallet signs this write. PromiseDecay never holds a key for you."}
                </p>
                {walletError ? (
                  <p className="pd-error" style={{ marginTop: 8 }} role="alert">
                    {walletError}
                  </p>
                ) : null}
              </div>
              {!account ? (
                <button
                  type="button"
                  className="pd-btn pd-btn--secondary"
                  onClick={() => void onConnect()}
                  data-testid="action-connect"
                >
                  Connect wallet
                </button>
              ) : null}
            </div>
          </GlassSurface>

          <TransactionPanel
            action={config.action}
            ctaLabel={config.cta}
            disabled={!valid || !account || (mode === "challenge" && promise?.isFinal === true)}
            disabledReason={
              promise?.isFinal === true && mode === "challenge"
                ? "This promise is already final."
                : !valid
                  ? "Fix the highlighted fields before signing."
                  : "Connect your wallet to sign this write."
            }
            buildArgs={buildArgs}
            onDone={() => {
              setValues({});
              setTouched(false);
              load();
            }}
          />
        </form>
      </div>
    </section>
  );
}

export { MODE_CONFIG };