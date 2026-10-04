/**
 * /record — record a promise.
 *
 * Human first: a source URL and the exact words, with the implication stated plainly.
 * Advanced semantic fields sit behind progressive disclosure. The wallet is only needed
 * at the moment of submission.
 */
import { useMemo, useState } from "react";
import { BOUNDS, URL_REJECTION_MESSAGE, checkSourceUrl } from "@promisedecay/domain";
import { GlassSurface, Notice } from "../components/primitives";
import { TransactionPanel } from "../components/TransactionPanel";
import { connect, currentAccount, currentChainId } from "../lib/chain";

interface FormState {
  sourceUrl: string;
  originalQuote: string;
  project: string;
  deadline: string;
  actor: string;
  action: string;
  object: string;
  scope: string;
  conditions: string;
}

const EMPTY: FormState = {
  sourceUrl: "",
  originalQuote: "",
  project: "",
  deadline: "",
  actor: "",
  action: "",
  object: "",
  scope: "",
  conditions: "",
};

/** Default deadline: 90 days out, as a yyyy-mm-dd input value. */
function defaultDeadline(): string {
  const d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function Record() {
  // Read once per mount. Reading the clock during render would make the validation memo
  // impure and, worse, would never re-evaluate as the day rolls over.
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  const [form, setForm] = useState<FormState>({ ...EMPTY, deadline: defaultDeadline() });
  const [advanced, setAdvanced] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Set once the user tries to submit. Empty-field errors wait for this.
  const [attempted, setAttempted] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Validation mirrors the contract exactly, so a user gets an immediate, specific
  // message instead of paying gas to discover a rejected transaction.
  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    const url = checkSourceUrl(form.sourceUrl);
    if (!url.ok) e.sourceUrl = URL_REJECTION_MESSAGE[url.reason];
    if (form.originalQuote.trim().length < 8) {
      e.originalQuote = "Quote the promise exactly as it was stated — at least 8 characters.";
    } else if (form.originalQuote.trim().length > BOUNDS.MAX_QUOTE) {
      e.originalQuote = `Keep the quote under ${BOUNDS.MAX_QUOTE} characters.`;
    }
    if (form.project.trim().length === 0) e.project = "Name the project or actor making the promise.";
    else if (form.project.trim().length > BOUNDS.MAX_SHORT) {
      e.project = `Keep the project name under ${BOUNDS.MAX_SHORT} characters.`;
    }
    if (!form.deadline) e.deadline = "Set the deadline the promise was made against.";
    else {
      const ts = Math.floor(new Date(`${form.deadline}T23:59:59Z`).getTime() / 1000);
      if (!Number.isFinite(ts)) e.deadline = "Enter a valid date.";
      else if (ts <= nowSeconds) e.deadline = "The deadline must be in the future.";
    }
    for (const k of ["actor", "action", "object", "scope", "conditions"] as const) {
      if (form[k].length > BOUNDS.MAX_SHORT) {
        e[k] = `Keep this under ${BOUNDS.MAX_SHORT} characters.`;
      }
    }
    return e;
  }, [form, nowSeconds]);

  const valid = Object.keys(errors).length === 0;

  /**
   * Should this field show its error yet?
   *
   * Showing an error the moment a field loses focus punishes someone who is merely passing
   * through it — tabbing from the quote to the disclosure toggle would light up an error on a
   * field they never meant to fill. Worse, the message appears between mousedown and mouseup,
   * shifting the page, so the control the user was actually reaching for moves out from under
   * the pointer and their first click is silently swallowed.
   *
   * So: a field that has content is corrected immediately (the user is clearly working on it),
   * and a field that is merely empty stays quiet until they try to submit.
   */
  const shouldShowError = (key: keyof FormState): boolean => {
    if (!errors[key]) return false;
    if (attempted) return true;
    if (!touched[key as string]) return false;
    // Only nag about emptiness after a real attempt; otherwise only correct real input.
    const value = String(form[key] ?? "").trim();
    return value.length > 0;
  };

  const onConnect = async () => {
    setWalletError(null);
    try {
      const accounts = await connect();
      setAccount(accounts[0] ?? null);
      const provider = (window as { ethereum?: Parameters<typeof currentAccount>[0] }).ethereum;
      if (provider) {
        const chain = await currentChainId(provider);
        if (chain !== 61999) {
          setWalletError(
            `Your wallet is on chain ${chain}. PromiseDecay is deployed on GenLayer chain 61999 — switch networks to record a promise.`
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

  const deadlineTs = form.deadline
    ? Math.floor(new Date(`${form.deadline}T23:59:59Z`).getTime() / 1000)
    : 0;

  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
      <div className="pd-shell">
        <header style={{ marginBottom: 26, maxWidth: "62ch" }}>
          <p className="pd-eyebrow">Record a promise</p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", margin: "10px 0 12px" }}>
            Put the promise on the record
          </h1>
          <p className="pd-muted" style={{ fontSize: "1.02rem" }}>
            Start with where it was said and what was actually said. Everything else is
            optional detail.
          </p>
        </header>

        <Notice tone="info" title="This creates an immutable public record">
          Once submitted, the original promise cannot be edited or deleted — not by you, not by
          the project, not by anyone. If the promise later changes, that change is added as a
          new entry in the lineage.
        </Notice>

        <form
          className="pd-stack"
          style={{ gap: 18, marginTop: 24 }}
          onSubmit={(e) => {
            e.preventDefault();
            // A submit attempt is the moment the user has genuinely engaged with the whole
            // form, so from here on every outstanding problem is worth saying out loud.
            setAttempted(true);
            setTouched({ sourceUrl: true, originalQuote: true, project: true, deadline: true });
          }}
        >
          {/* ------------------------------------------------- the two real fields */}
          <GlassSurface tone="heavy" className="pd-glass__pad">
            <div className="pd-stack" style={{ gap: 20 }}>
              <Field
                id="sourceUrl"
                label="Where was it said?"
                hint="The page, post or announcement containing the promise."
                error={shouldShowError("sourceUrl") ? errors.sourceUrl : undefined}
                counter={`${form.sourceUrl.length}/${BOUNDS.MAX_URL}`}
                over={form.sourceUrl.length > BOUNDS.MAX_URL}
              >
                <input
                  id="sourceUrl"
                  className="pd-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/blog/announcement"
                  value={form.sourceUrl}
                  onChange={(e) => set("sourceUrl", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, sourceUrl: true }))}
                  aria-invalid={Boolean(shouldShowError("sourceUrl"))}
                  aria-describedby="sourceUrl-hint"
                  required
                  data-testid="record-source-url"
                />
              </Field>

              <Field
                id="originalQuote"
                label="What was actually said?"
                hint="Quote it exactly. Do not paraphrase — the wording is the commitment."
                error={shouldShowError("originalQuote") ? errors.originalQuote : undefined}
                counter={`${form.originalQuote.length}/${BOUNDS.MAX_QUOTE}`}
                over={form.originalQuote.length > BOUNDS.MAX_QUOTE}
              >
                <textarea
                  id="originalQuote"
                  className="pd-textarea"
                  placeholder="Public mainnet will launch before September 30."
                  value={form.originalQuote}
                  onChange={(e) => set("originalQuote", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, originalQuote: true }))}
                  aria-invalid={Boolean(shouldShowError("originalQuote"))}
                  aria-describedby="originalQuote-hint"
                  rows={3}
                  required
                  data-testid="record-quote"
                />
              </Field>

              <div className="pd-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
                <Field
                  id="project"
                  label="Project"
                  hint="Who made the promise."
                  error={shouldShowError("project") ? errors.project : undefined}
                  counter={`${form.project.length}/${BOUNDS.MAX_SHORT}`}
                  over={form.project.length > BOUNDS.MAX_SHORT}
                >
                  <input
                    id="project"
                    className="pd-input"
                    placeholder="Acme Protocol"
                    value={form.project}
                    onChange={(e) => set("project", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, project: true }))}
                    aria-invalid={Boolean(shouldShowError("project"))}
                    required
                    data-testid="record-project"
                  />
                </Field>

                <Field
                  id="deadline"
                  label="Deadline"
                  hint="The date the promise was made against."
                  error={shouldShowError("deadline") ? errors.deadline : undefined}
                >
                  <input
                    id="deadline"
                    className="pd-input"
                    type="date"
                    value={form.deadline}
                    onChange={(e) => set("deadline", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, deadline: true }))}
                    aria-invalid={Boolean(shouldShowError("deadline"))}
                    required
                    data-testid="record-deadline"
                  />
                </Field>
              </div>
            </div>
          </GlassSurface>

          {/* ------------------------------------------------------- progressive */}
          <div>
            <button
              type="button"
              className="pd-btn pd-btn--ghost pd-btn--sm"
              aria-expanded={advanced}
              onClick={() => setAdvanced((v) => !v)}
              data-testid="record-toggle-advanced"
            >
              {advanced ? "− Hide detail fields" : "+ Add detail fields (optional)"}
            </button>

            {advanced ? (
              <GlassSurface className="pd-glass__pad" style={{ marginTop: 14 }}>
                <p className="pd-hint" style={{ marginBottom: 16 }}>
                  These help validators judge scope and delivery later. They are optional and can be
                  left blank.
                </p>
                <div className="pd-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 18 }}>
                  {(
                    [
                      ["actor", "Actor", "The organisation or person behind the promise."],
                      ["action", "Action", "e.g. launch, open-source, publish"],
                      ["object", "Object", "What the action applies to."],
                      ["scope", "Scope", "e.g. public, selected partners"],
                      ["conditions", "Conditions", "Any stated conditions."],
                    ] as const
                  ).map(([key, label, hint]) => (
                    <Field
                      key={key}
                      id={key}
                      label={label}
                      hint={hint}
                      error={errors[key]}  // optional fields: length-only, always fair to show
                      counter={`${form[key].length}/${BOUNDS.MAX_SHORT}`}
                      over={form[key].length > BOUNDS.MAX_SHORT}
                    >
                      <input
                        id={key}
                        className="pd-input"
                        value={form[key]}
                        onChange={(e) => set(key, e.target.value)}
                        aria-invalid={Boolean(errors[key])}
                      />
                    </Field>
                  ))}
                </div>
              </GlassSurface>
            ) : null}
          </div>

          {/* ------------------------------------------------------------ submit */}
          <GlassSurface tone="heavy" className="pd-glass__pad">
            <div className="pd-row pd-wrap" style={{ gap: 16, justifyContent: "space-between" }}>
              <div className="pd-grow" style={{ minWidth: 240 }}>
                <p style={{ fontWeight: 640, marginBottom: 5 }}>Signing with your wallet</p>
                <p className="pd-hint">
                  {account
                    ? `Connected as ${account.slice(0, 6)}…${account.slice(-4)}. The promise will be signed by this address.`
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
                  data-testid="record-connect"
                >
                  Connect wallet
                </button>
              ) : null}
            </div>
          </GlassSurface>

          <TransactionPanel
            action="Record promise"
            ctaLabel="Sign and record this promise"
            disabled={!valid || !account}
            disabledReason={
              !valid
                ? "Fill in the source URL, the exact quote, the project and a future deadline."
                : "Connect your wallet to sign this write."
            }
            buildArgs={() => [
              form.project.trim(),
              (form.actor || form.project).trim(),
              form.originalQuote.trim(),
              (form.action || "deliver").trim(),
              (form.object || form.project).trim(),
              (form.scope || "public").trim(),
              deadlineTs,
              form.conditions.trim(),
              form.sourceUrl.trim(),
            ]}
            onDone={() => {
              setTouched({});
              setForm({ ...EMPTY, deadline: defaultDeadline() });
            }}
          />
        </form>
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  counter,
  over,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string;
  counter?: string;
  over?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="pd-field">
      <label className="pd-label" htmlFor={id}>
        {label}
      </label>
      {children}
      <div className="pd-row" style={{ gap: 10, alignItems: "baseline" }}>
        <span className="pd-hint" id={`${id}-hint`}>
          {hint}
        </span>
        {counter ? (
          <span className={cxCounter(over)} style={{ marginLeft: "auto", flexShrink: 0 }}>
            {counter}
          </span>
        ) : null}
      </div>
      {/*
        The slot is always present and only its content is conditional. An error message
        that appears for the first time used to push the whole rest of the form down by
        ~460px, which threw the submit control out from under the user mid-interaction
        and cost real Cumulative Layout Score. Reserving the line keeps the layout stable.
      */}
      <div className="pd-field__error-slot" aria-live="polite">
        {error ? (
          <p className="pd-error" role="alert">
            <span aria-hidden="true">⚠</span>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function cxCounter(over?: boolean): string {
  return over ? "pd-counter pd-counter--over" : "pd-counter";
}