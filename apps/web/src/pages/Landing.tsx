/**
 * Landing page.
 *
 * The product, not documentation pasted above the dApp. Every section has a visual
 * purpose: the hero shows a real reconstruction of a real promise, the strip shows live
 * indexed records, and the drift section explains the signature concept with the actual
 * timeline component.
 */
import { useEffect, useState } from "react";
import { PromiseLens } from "../components/PromiseLens";
import {
  EmptyState,
  GlassSurface,
  Notice,
  PromiseCard,
  PromiseSkeleton,
  SectionHead,
  cx,
} from "../components/primitives";
import { ApiClientError, api, type ApiPromise } from "../lib/api";

const STEPS = [
  {
    n: "01",
    color: "var(--cobalt)",
    title: "Record",
    body: "A source URL and the exact words. The original becomes an immutable public record the moment you sign — it can never be quietly edited later.",
  },
  {
    n: "02",
    color: "var(--amber)",
    title: "Track",
    body: "Attach later statements to the same promise. PromiseDecay classifies how each one changed the wording, scope or intent, and draws the lineage.",
  },
  {
    n: "03",
    color: "var(--lime)",
    title: "Resolve",
    body: "After the deadline, validators read the evidence and reach consensus on delivery and integrity separately. Anyone can challenge the result.",
  },
];

const WHY_GENLAYER = [
  {
    title: "Judgement needs reading, not lookup",
    body: "“Did they keep the promise?” is a question about meaning. It needs the page to be understood, not merely fetched. GenLayer Intelligent Contracts can read the web and reason about it on chain.",
  },
  {
    title: "One node is never enough",
    body: "A single AI answer is an opinion. GenLayer validators execute the judgement independently and must agree on the decision before it is written.",
  },
  {
    title: "Consensus on structure, not prose",
    body: "Two validators writing different sentences is fine. Two validators disagreeing on PARTIAL versus NOT_KEPT is not. The verdict is agreed; the wording is allowed to differ.",
  },
];

const TRUST = [
  {
    title: "Originals are immutable",
    body: "The original promise is written once. There is no method, and no API route, that edits it. Drift is added as a new linked record instead.",
  },
  {
    title: "Evidence is public",
    body: "Every submission carries its source URL and is permanently linked to the promise. Anyone can check the basis of a verdict themselves.",
  },
  {
    title: "Anyone can challenge",
    body: "A provisional result stays open for a bounded window. A challenge must bring materially new evidence, is recorded forever, and triggers real re-evaluation.",
  },
  {
    title: "You sign your own writes",
    body: "Every write is signed by your wallet. The server holds no key for user actions and never marks a transaction final on your behalf.",
  },
];

export function Landing() {
  const [promises, setPromises] = useState<ApiPromise[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api
      .listPromises({ limit: 3 }, ac.signal)
      .then((p) => setPromises(p.items))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load live promises right now."
        );
      });
    return () => ac.abort();
  }, []);

  return (
    <>
      {/* ------------------------------------------------------------------ hero -- */}
      <section className="pd-hero">
        <div className="pd-shell pd-shell--wide">
          <div className="pd-hero__grid">
            <div className="pd-hero__copy">
              <p className="pd-hero__brandline">
                Said<span>.</span> Tracked<span>.</span> Resolved<span>.</span>
              </p>

              <h1 className="pd-hero__title">Promises deserve a memory.</h1>

              <p className="pd-hero__lede">
                PromiseDecay preserves public commitments, tracks how they change, and uses
                GenLayer consensus to determine what was actually delivered.
              </p>

              <div className="pd-hero__cta">
                <a className="pd-btn pd-btn--primary pd-btn--lg" href="/explore" data-testid="cta-explore">
                  Explore promises
                </a>
                <a className="pd-btn pd-btn--secondary pd-btn--lg" href="/record" data-testid="cta-record">
                  Record a promise
                </a>
              </div>

              <div className="pd-hero__proof">
                <span>
                  <strong>Immutable</strong> original records
                </span>
                <span>
                  <strong>Append-only</strong> promise drift
                </span>
                <span>
                  <strong>Two axes</strong> — delivery &amp; integrity
                </span>
              </div>
            </div>

            <PromiseLens />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- live promise strip */}
      <section className="pd-section" style={{ paddingBlock: "clamp(24px, 4vw, 44px)" }}>
        <div className="pd-shell pd-shell--wide">
          <div className="pd-row pd-wrap" style={{ justifyContent: "space-between", gap: 14, marginBottom: 18 }}>
            <div>
              <p className="pd-eyebrow">Live records</p>
              <h2 style={{ fontSize: "clamp(1.35rem, 2.4vw, 1.8rem)", marginTop: 8 }}>
                Indexed from chain
              </h2>
            </div>
            <a className="pd-btn pd-btn--ghost pd-btn--sm" href="/explore">
              View all →
            </a>
          </div>

          {error ? (
            <Notice tone="error" title="Live records are unavailable">
              {error} The rest of this page works without them —{" "}
              <a href="/explore" style={{ color: "var(--sky)" }}>
                try explore again
              </a>
              .
            </Notice>
          ) : promises === null ? (
            <div className="pd-grid pd-grid--cards">
              <PromiseSkeleton />
              <PromiseSkeleton />
              <PromiseSkeleton />
            </div>
          ) : promises.length === 0 ? (
            <EmptyState
              title="No promises recorded yet"
              body="Nothing is indexed on this deployment so far. The first record starts the history."
              icon="◷"
              action={
                <a className="pd-btn pd-btn--primary" href="/record">
                  Record the first promise
                </a>
              }
            />
          ) : (
            <div className="pd-grid pd-grid--cards" data-testid="live-strip">
              {promises.map((p) => (
                <PromiseCard key={p.promiseId} promise={p} priority />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* -------------------------------------------------------- promise drift */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <div className="pd-split pd-split--reverse">
            <div>
              <SectionHead
                eyebrow="The signature feature"
                title="A promise rarely changes in one clean jump"
                body="Softening. Narrowing. A deadline quietly moving. PromiseDecay keeps every later statement attached to the original so the drift is visible instead of inferred."
              />
              <div className="pd-row pd-wrap" style={{ gap: 10 }}>
                <a className="pd-btn pd-btn--secondary" href="/how-it-works">
                  How drift works
                </a>
                <a className="pd-btn pd-btn--ghost" href="/explore">
                  Browse records →
                </a>
              </div>
            </div>

            <GlassSurface tone="heavy" className="pd-glass__pad">
              {/* The example verdict below is illustrative, not a live record. Every promise
                  currently on chain resolves UNRESOLVED, because their evidence genuinely does
                  not establish an outcome and the contract refuses to guess. Labelled so the
                  rail reads as a demonstration of the mechanism rather than a result. */}
              <p className="pd-muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>
                Worked example — illustrative, not a live record
              </p>
              <ol className="pd-rail" data-testid="landing-drift-example">
                <li
                  className="pd-rail__step pd-rail__step--origin"
                  style={{ ["--step-color" as string]: "var(--cobalt)" }}
                >
                  <span className="pd-rail__node" aria-hidden="true" />
                  <div className="pd-rail__date">MAY 12</div>
                  <div className="pd-rail__label">Original</div>
                  <p className="pd-rail__statement pd-quote">
                    “Public mainnet <span className="pd-diff-removed">public</span> before September 30”
                  </p>
                </li>
                <li className="pd-rail__step" style={{ ["--step-color" as string]: "var(--coral)" }}>
                  <span className="pd-rail__node" aria-hidden="true" />
                  <div className="pd-rail__date">SEP 18</div>
                  <div className="pd-rail__label">
                    NARROWED <span style={{ color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0 }}>· scope narrowed</span>
                  </div>
                  <p className="pd-rail__statement">
                    “<span className="pd-diff-added">Selected ecosystem partners</span> receive access in September”
                  </p>
                </li>
                <li className="pd-rail__step" style={{ ["--step-color" as string]: "var(--silver)" }}>
                  <span className="pd-rail__node" aria-hidden="true" />
                  <div className="pd-rail__date">SEP 30</div>
                  <div className="pd-rail__label" style={{ color: "var(--text-secondary)" }}>
                    Deadline reached
                  </div>
                </li>
                <li className="pd-rail__step" style={{ ["--step-color" as string]: "var(--lime)" }}>
                  <span className="pd-rail__node" aria-hidden="true" />
                  <div className="pd-rail__label">Resolution</div>
                  <div className="pd-row pd-wrap" style={{ gap: 8, marginTop: 4 }}>
                    <span className="pd-chip pd-chip--lg" style={{ ["--chip-color" as string]: "var(--sky)" }}>
                      <span className="pd-chip__dot" aria-hidden="true" />
                      PARTIAL
                    </span>
                    <span className="pd-chip pd-chip--lg" style={{ ["--chip-color" as string]: "var(--coral)" }}>
                      <span className="pd-chip__dot" aria-hidden="true" />
                      NARROWED
                    </span>
                  </div>
                </li>
              </ol>
            </GlassSurface>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <SectionHead
            eyebrow="How it works"
            title="Record, track, resolve"
            body="Three steps, and none of them require trusting a platform's opinion."
          />
          <div className="pd-steps">
            {STEPS.map((s) => (
              <div className="pd-step" key={s.n} style={{ ["--step-color" as string]: s.color }}>
                <span className="pd-step__num" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- why genlayer */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <SectionHead
            eyebrow="Why GenLayer"
            title="Reading a promise is a judgement, not a lookup"
            body="GenLayer Intelligent Contracts are the only place where semantic judgement and decentralized consensus meet."
          />
          <div className="pd-grid pd-grid--halves">
            {WHY_GENLAYER.map((w, i) => (
              <GlassSurface key={w.title} className="pd-glass__pad" tone={i === 0 ? "heavy" : "default"}>
                <h3 style={{ fontSize: "1.08rem", marginBottom: 9 }}>{w.title}</h3>
                <p className="pd-muted" style={{ fontSize: "0.93rem", lineHeight: 1.6 }}>
                  {w.body}
                </p>
              </GlassSurface>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ trust */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <SectionHead
            eyebrow="Trust &amp; security"
            title="Built so the record cannot be quietly rewritten"
            body="Every claim below is enforced by the contract or by the absence of a capability."
          />
          <div className="pd-grid pd-grid--halves">
            {TRUST.map((t) => (
              <div key={t.title} className="pd-row" style={{ gap: 13, alignItems: "flex-start" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    background: "rgba(61, 229, 140, 0.14)",
                    border: "1px solid rgba(61, 229, 140, 0.34)",
                    color: "var(--green)",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  ✓
                </span>
                <div>
                  <h3 style={{ fontSize: "1rem", marginBottom: 5 }}>{t.title}</h3>
                  <p className="pd-muted" style={{ fontSize: "0.92rem", lineHeight: 1.58 }}>
                    {t.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 26 }}>
            <a className="pd-btn pd-btn--secondary" href="/docs/security">
              Read the security review
            </a>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- roadmap */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <div className="pd-split">
            <div>
              <SectionHead
                eyebrow="Public roadmap"
                title="What is shipped, and what is not"
                body="The roadmap is public and honest: future work is labelled as future, and V1 is only marked shipped once it is verified on chain."
              />
              <a className="pd-btn pd-btn--secondary" href="/roadmap">
                See the full roadmap
              </a>
            </div>
            <GlassSurface tone="heavy" className="pd-glass__pad">
              <div className="pd-stack" style={{ gap: 14 }}>
                {[
                  { v: "V1", s: "Public Promise Memory", state: "Shipped", color: "var(--lime)" },
                  { v: "V1.1", s: "Verified project identity, watchlists, share cards", state: "Planned", color: "var(--sky)" },
                  { v: "V1.2", s: "Notifications and source monitoring", state: "Planned", color: "var(--amber)" },
                  { v: "V2", s: "Promise Graph and composable commitment history", state: "Planned", color: "var(--silver)" },
                ].map((r) => (
                  <div
                    key={r.v}
                    className="pd-row"
                    style={{
                      gap: 14,
                      padding: "13px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <span className="pd-mono" style={{ color: "var(--text-tertiary)", width: 46, flexShrink: 0 }}>
                      {r.v}
                    </span>
                    <span className="pd-grow">{r.s}</span>
                    <span
                      className="pd-chip"
                      style={{ ["--chip-color" as string]: r.color }}
                    >
                      <span className="pd-chip__dot" aria-hidden="true" />
                      {r.state}
                    </span>
                  </div>
                ))}
              </div>
            </GlassSurface>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- build public */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <div className="pd-split">
            <GlassSurface tone="heavy" className="pd-glass__pad">
              <p className="pd-eyebrow">Build in public</p>
              <h3 style={{ fontSize: "1.3rem", margin: "10px 0 12px" }}>
                The contract, the API and this page are all open source.
              </h3>
              <p className="pd-muted" style={{ fontSize: "0.94rem", lineHeight: 1.62 }}>
                Read the Intelligent Contract that decides every verdict. Inspect the API that
                serves it. Check the tests that prove the state machine cannot be abused.
              </p>
              <div className="pd-row pd-wrap" style={{ gap: 10, marginTop: 18 }}>
                <a
                  className="pd-btn pd-btn--primary pd-btn--sm"
                  href="https://github.com/0xbardia/PromiseDecay"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  GitHub repository
                </a>
                <a className="pd-btn pd-btn--secondary pd-btn--sm" href="/docs/contract">
                  Read the contract
                </a>
              </div>
            </GlassSurface>

            <div>
              <SectionHead
                eyebrow="Try it"
                title="Start with a promise someone made to you"
                body="If a deadline was set publicly, it can be recorded publicly — and kept."
              />
              <div className="pd-row pd-wrap" style={{ gap: 12 }}>
                <a className="pd-btn pd-btn--primary" href="/record">
                  Record a promise
                </a>
                <a className="pd-btn pd-btn--ghost" href="/explore">
                  Browse what exists →
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export { STEPS, WHY_GENLAYER, TRUST, cx };