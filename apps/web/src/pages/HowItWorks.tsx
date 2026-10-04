/**
 * /how-it-works — the concept, explained without jargon.
 */
import { GlassSurface, Notice, SectionHead, StatusChip } from "../components/primitives";
import { CONTRACT_ADDRESS, NETWORK_NAME } from "../lib/chain";

const DELIVERY_STEPS: Array<{ v: string; d: string }> = [
  { v: "KEPT", d: "Delivered in full by the deadline." },
  { v: "KEPT_LATE", d: "Delivered in full, but late." },
  { v: "PARTIAL", d: "Delivered only in part, or only to part of the promised audience." },
  { v: "NOT_KEPT", d: "Not delivered." },
  { v: "UNRESOLVED", d: "The evidence does not establish what happened." },
];

const INTEGRITY_STEPS: Array<{ v: string; d: string }> = [
  { v: "UNCHANGED", d: "The promise kept its original meaning and scope." },
  { v: "NARROWED", d: "Scope reduced — “public” became “selected partners”." },
  { v: "REFRAMED", d: "Restated to mean something else." },
  { v: "REVERSED", d: "Withdrawn or inverted." },
  { v: "UNKNOWN", d: "Not established by the evidence." },
];

const LIFECYCLE: Array<{ v: string; d: string }> = [
  { v: "OPEN", d: "Recorded. The deadline has not passed." },
  { v: "DUE", d: "The deadline has passed; resolution can be requested." },
  { v: "RESOLVING", d: "Validators are evaluating the evidence." },
  { v: "PROVISIONAL", d: "A verdict exists and is open for challenge." },
  { v: "CHALLENGE_WINDOW", d: "Open for a bounded period. A challenge must bring new evidence." },
  { v: "FINAL", d: "The window closed. The verdict is final and cannot regress." },
];

export function HowItWorks() {
  return (
    <>
      <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
        <div className="pd-shell">
          <header style={{ maxWidth: "66ch", marginBottom: 34 }}>
            <p className="pd-eyebrow">How it works</p>
            <h1 style={{ fontSize: "clamp(2.1rem, 4.4vw, 3.2rem)", margin: "10px 0 14px" }}>
              A promise has three parts, and they are kept apart
            </h1>
            <p className="pd-muted" style={{ fontSize: "1.06rem", lineHeight: 1.64 }}>
              Most of the world keeps a single score for whether someone is trustworthy.
              PromiseDecay keeps the record instead, because the interesting part is not a
              number — it is what was said, what changed, and what actually happened.
            </p>
          </header>

          <div className="pd-steps">
            {[
              {
                n: "01",
                color: "var(--cobalt)",
                title: "The original",
                body: "A source URL and the exact words. Once signed, this is immutable: there is no method and no API route that edits it. Not by you, not by the project.",
              },
              {
                n: "02",
                color: "var(--coral)",
                title: "The drift",
                body: "Later statements are appended to the original, never merged into it. PromiseDecay classifies how each one changed the wording, scope or intent, so softening is visible instead of inferred.",
              },
              {
                n: "03",
                color: "var(--lime)",
                title: "The resolution",
                body: "After the deadline, validators read the evidence and agree on delivery and integrity separately. Anyone can challenge the result inside a bounded window with materially new evidence.",
              },
            ].map((s) => (
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

      {/* ------------------------------------------------------------ the two axes */}
      <section className="pd-section" style={{ paddingBlock: 0 }}>
        <div className="pd-shell pd-shell--wide">
          <SectionHead
            eyebrow="Two axes"
            title="Delivery and integrity are different questions"
            body="A promise can be delivered and still hollowed out. Reporting one verdict for both would hide exactly the thing worth noticing."
          />
          <div className="pd-grid pd-grid--halves">
            <GlassSurface tone="heavy" className="pd-glass__pad">
              <p className="pd-eyebrow" style={{ marginBottom: 14 }}>
                Delivery — was it delivered?
              </p>
              <ul className="pd-stack" style={{ gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
                {DELIVERY_STEPS.map((s) => (
                  <li key={s.v} className="pd-row" style={{ gap: 12, alignItems: "flex-start" }}>
                    <StatusChip value={s.v} kind="delivery" />
                    <span className="pd-muted pd-grow" style={{ fontSize: "0.92rem", lineHeight: 1.5 }}>
                      {s.d}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassSurface>

            <GlassSurface tone="heavy" className="pd-glass__pad">
              <p className="pd-eyebrow" style={{ marginBottom: 14 }}>
                Integrity — did the promise keep its meaning?
              </p>
              <ul className="pd-stack" style={{ gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
                {INTEGRITY_STEPS.map((s) => (
                  <li key={s.v} className="pd-row" style={{ gap: 12, alignItems: "flex-start" }}>
                    <StatusChip value={s.v} kind="integrity" />
                    <span className="pd-muted pd-grow" style={{ fontSize: "0.92rem", lineHeight: 1.5 }}>
                      {s.d}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassSurface>
          </div>

          <div style={{ marginTop: 24 }}>
            <Notice tone="info" title="PARTIAL / NARROWED is a first-class answer">
              “Public mainnet before September 30” followed by “Selected ecosystem partners
              receive access in September” resolves to PARTIAL delivery with NARROWED integrity.
              The system is not hedging: it is reporting precisely what happened, on two axes
              instead of collapsing them into true or false.
            </Notice>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- lifecycle */}
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <SectionHead
            eyebrow="Lifecycle"
            title="How a record moves from promise to verdict"
            body="The lifecycle is enforced in the contract, not in the interface. Each transition has a precondition."
          />
          <GlassSurface className="pd-glass__pad">
            <ol className="pd-rail">
              {LIFECYCLE.map((s, i) => (
                <li
                  key={s.v}
                  className={`pd-rail__step${i === 0 ? " pd-rail__step--origin" : ""}`}
                  style={
                    { "--step-color": i === LIFECYCLE.length - 1 ? "var(--lime)" : "var(--cobalt)" } as React.CSSProperties
                  }
                >
                  <span className="pd-rail__node" aria-hidden="true" />
                  <div className="pd-rail__label">{s.v.replace(/_/g, " ")}</div>
                  <p className="pd-rail__statement pd-muted" style={{ fontSize: "0.95rem" }}>
                    {s.d}
                  </p>
                </li>
              ))}
            </ol>
          </GlassSurface>
        </div>
      </section>

      {/* ----------------------------------------------------------------- who can */}
      <section className="pd-section" style={{ paddingBlock: 0 }}>
        <div className="pd-shell pd-shell--wide">
          <SectionHead
            eyebrow="Participation"
            title="Who can do what"
            body="Reading is open to everyone and needs no wallet. Writing is signed by you. The right to respond is not the right to rewrite history."
          />
          <div className="pd-grid pd-grid--halves">
            {[
              {
                t: "Anyone",
                b: "Browse, search, and read any promise, its lineage, its evidence and its verdict. No wallet required.",
              },
              {
                t: "Anyone",
                b: "Record a promise, add evidence, attach a later statement, or submit a public response — each signed by your own wallet.",
              },
              {
                t: "Anyone, inside the window",
                b: "Challenge a provisional result. The challenge must cite a source not already used as evidence and explain what the verdict missed.",
              },
              {
                t: "No one, after finalization",
                b: "A final result cannot be reversed. The original cannot be edited. Evidence and drift close; late responses are still recorded but change nothing.",
              },
            ].map((r) => (
              <GlassSurface key={r.t} className="pd-glass__pad">
                <p className="pd-eyebrow">{r.t}</p>
                <p className="pd-muted" style={{ fontSize: "0.95rem", lineHeight: 1.6, marginTop: 9 }}>
                  {r.b}
                </p>
              </GlassSurface>
            ))}
          </div>

          <div className="pd-row pd-wrap" style={{ gap: 12, marginTop: 30 }}>
            <a className="pd-btn pd-btn--primary" href="/record">
              Record a promise
            </a>
            <a className="pd-btn pd-btn--secondary" href="/explore">
              Explore promises
            </a>
            <a className="pd-btn pd-btn--ghost" href="/docs/consensus">
              How consensus works
            </a>
          </div>

          <p className="pd-hint" style={{ marginTop: 26 }}>
            Running on {NETWORK_NAME} · contract{" "}
            <span className="pd-mono">{CONTRACT_ADDRESS ?? "not configured"}</span>
          </p>
        </div>
      </section>
    </>
  );
}