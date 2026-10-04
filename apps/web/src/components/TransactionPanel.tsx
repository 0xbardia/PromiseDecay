/**
 * TransactionPanel — real transaction lifecycle UX.
 *
 * Every stage is named and explained: waiting for wallet → submitted → consensus →
 * accepted → final, or failed. A transaction is never shown as final unless the chain
 * said so, and rejection in the wallet is presented as a recoverable outcome with a clear
 * way to try again.
 */
import { useState } from "react";
import { Notice } from "./primitives";
import {
  STAGE_COPY,
  STAGE_ORDER,
  UserRejectedError,
  WrongNetworkError,
  explorerTxUrl,
  writeContract,
  type TxStage,
} from "../lib/chain";

export interface TransactionPanelProps {
  action: string;
  ctaLabel: string;
  buildArgs: () => unknown[];
  disabled?: boolean;
  disabledReason?: string;
  onDone?: (hash: string) => void;
  children?: React.ReactNode;
}

export function TransactionPanel({
  action,
  ctaLabel,
  buildArgs,
  disabled,
  disabledReason,
  onDone,
  children,
}: TransactionPanelProps) {
  const [stage, setStage] = useState<TxStage>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [message, setMessage] = useState(STAGE_COPY.idle);
  const [running, setRunning] = useState(false);
  const [success, setSuccess] = useState(false);

  const stageIndex = STAGE_ORDER.indexOf(stage);

  const submit = async () => {
    setRunning(true);
    setSuccess(false);
    setStage("awaiting-wallet");
    setHash(null);
    setMessage(STAGE_COPY["awaiting-wallet"]);

    try {
      const res = await writeContract({
        functionName: contractMethodFor(action),
        args: buildArgs(),
        onProgress: (p) => {
          setStage(p.stage);
          setHash(p.hash);
          setMessage(p.message);
        },
      });
      setSuccess(true);
      onDone?.(res.hash);
    } catch (err) {
      setStage("failed");
      if (err instanceof UserRejectedError) {
        setMessage("You rejected the signature. Nothing was submitted — you can try again.");
      } else if (err instanceof WrongNetworkError) {
        setMessage(err.message);
      } else {
        setMessage(
          (err as Error).message ||
            "The transaction did not complete. Check your wallet and the network, then try again."
        );
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="pd-stack" style={{ gap: 16 }} data-testid="transaction-panel">
      {children}

      {!running && !success && (
        <div>
          <button
            type="button"
            className="pd-btn pd-btn--primary pd-btn--lg"
            onClick={() => void submit()}
            disabled={disabled || running}
            data-testid="tx-submit"
          >
            {ctaLabel}
          </button>
          {disabled && disabledReason ? (
            <p className="pd-hint" style={{ marginTop: 10 }}>
              {disabledReason}
            </p>
          ) : null}
        </div>
      )}

      {(running || success || stage === "failed") && (
        <div
          className="pd-tx"
          style={{
            ["--tx-color" as string]:
              stage === "failed" ? "var(--red)" : success ? "var(--green)" : "var(--lime)",
          }}
          data-testid="tx-status"
          data-stage={stage}
          role="status"
          aria-live="polite"
        >
          <div className="pd-row pd-wrap" style={{ gap: 10 }}>
            <strong style={{ fontSize: "0.98rem" }}>{action}</strong>
            {success ? (
              <span className="pd-chip" style={{ ["--chip-color" as string]: "var(--green)" }}>
                <span className="pd-chip__dot" aria-hidden="true" />
                Confirmed
              </span>
            ) : stage === "failed" ? (
              <span className="pd-chip" style={{ ["--chip-color" as string]: "var(--red)" }}>
                <span className="pd-chip__dot" aria-hidden="true" />
                Failed
              </span>
            ) : null}
          </div>

          {/* Stage track: completed stages, the active stage, and what comes next. */}
          <ol className="pd-tx__steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {STAGE_ORDER.map((s, i) => {
              const done = stage === "final" ? true : i < stageIndex;
              const active = s === stage && stage !== "final" && stage !== "failed";
              return (
                <li
                  key={s}
                  className={
                    "pd-tx__step" +
                    (done ? " pd-tx__step--done" : "") +
                    (active ? " pd-tx__step--active" : "")
                  }
                  data-testid={`tx-step-${s}`}
                  data-state={done ? "done" : active ? "active" : "pending"}
                >
                  {active ? <span className="pd-tx__spinner" aria-hidden="true" /> : null}
                  {STAGE_COPY[s]}
                </li>
              );
            })}
          </ol>

          <p
            className="pd-muted"
            style={{ fontSize: "0.92rem" }}
            style-color-var="--text-secondary"
          >
            <span data-testid="tx-message">{message}</span>
          </p>

          {hash ? (
            <a
              className="pd-tx__hash pd-inner-link"
              href={explorerTxUrl(hash)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {hash} ↗
            </a>
          ) : null}

          {stage === "failed" ? (
            <div>
              <button
                type="button"
                className="pd-btn pd-btn--secondary pd-btn--sm"
                onClick={() => {
                  setStage("idle");
                  setHash(null);
                  setMessage(STAGE_COPY.idle);
                  setSuccess(false);
                }}
                data-testid="tx-retry"
              >
                Try again
              </button>
            </div>
          ) : null}

          {success ? (
            <Notice tone="success" title="Recorded on chain">
              This write is final. The record is now part of the permanent history.
            </Notice>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Map a UI action to the contract method it calls. */
function contractMethodFor(action: string): string {
  switch (action) {
    case "Add evidence":
      return "add_evidence";
    case "Add later statement":
      return "add_drift";
    case "Submit response":
      return "submit_response";
    case "Challenge result":
      return "challenge";
    default:
      return "create_promise";
  }
}

export { contractMethodFor };