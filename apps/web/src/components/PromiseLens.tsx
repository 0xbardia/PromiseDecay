/**
 * Promise Lens — the hero's signature visual.
 *
 * This is a real reconstruction of a real promise, not an abstract blob: it shows the
 * original wording, the later wording, exactly which words were dropped and added, and
 * the resulting delivery/integrity verdict. It is the same information a user sees on the
 * promise page, compressed into the hero.
 *
 * State changes are driven by user interaction (and auto-advance), and every transition
 * is disabled under prefers-reduced-motion while still showing the finished state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DELIVERY, INTEGRITY, type Delivery, type Integrity } from "@promisedecay/domain";
import { StatusChip } from "./primitives";

interface LensFrame {
  phase: string;
  date: string;
  quote: string;
  /** Words present in the original but not here. */
  removed: string[];
  /** Words introduced at this step. */
  added: string[];
  delivery: Delivery;
  integrity: Integrity;
  note: string;
}

const FRAMES: LensFrame[] = [
  {
    phase: "Original",
    date: "May 12",
    quote: "Public mainnet before September 30",
    removed: [],
    added: [],
    delivery: DELIVERY.UNRESOLVED,
    integrity: INTEGRITY.UNCHANGED,
    note: "A public launch, promised in public, with a date attached.",
  },
  {
    phase: "Wording softened",
    date: "Aug 21",
    quote: "Mainnet rollout begins in September",
    removed: ["public", "before"],
    added: ["rollout"],
    delivery: DELIVERY.UNRESOLVED,
    integrity: INTEGRITY.UNCHANGED,
    note: "The date stops being a commitment and the audience stops being named.",
  },
  {
    phase: "Scope narrowed",
    date: "Sep 18",
    quote: "Selected ecosystem partners receive access in September",
    removed: ["public", "before"],
    added: ["selected", "ecosystem", "partners", "receive", "access"],
    delivery: DELIVERY.PARTIAL,
    integrity: INTEGRITY.NARROWED,
    note: "The launch happened. Not for everyone who was promised it.",
  },
  {
    phase: "Deadline reached",
    date: "Sep 30",
    quote: "Selected ecosystem partners receive access in September",
    removed: [],
    added: [],
    delivery: DELIVERY.PARTIAL,
    integrity: INTEGRITY.NARROWED,
    note: "The deadline passes with the promise still unmet in its original form.",
  },
];

const AUTOPLAY_MS = 5200;

function highlight(quote: string, removed: string[], added: string[]) {
  const tokens = quote.split(/(\s+)/);
  return tokens.map((token, i) => {
    const bare = token.toLowerCase().replace(/[^a-z]/g, "");
    if (removed.includes(bare)) {
      return (
        <span className="pd-lens__removed" key={`r-${i}`}>
          {token}
        </span>
      );
    }
    if (added.includes(bare)) {
      return (
        <span className="pd-lens__added" key={`a-${i}`}>
          {token}
        </span>
      );
    }
    return token;
  });
}

export function PromiseLens() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % FRAMES.length);
  }, []);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + FRAMES.length) % FRAMES.length);
  }, []);

  // Auto-advance stops under reduced motion: the final state is shown instead, fully formed.
  useEffect(() => {
    if (paused || prefersReducedMotion) return;
    const t = setTimeout(next, AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [index, paused, prefersReducedMotion, next]);

  const frame = FRAMES[index]!;

  // Keyboard support: the lens is a labelled group with previous/next controls.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    }
  };

  return (
    <div
      className="pd-lens"
      ref={frameRef}
      tabIndex={0}
      role="group"
      aria-roledescription="carousel"
      aria-label="How a promise changed over time"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="promise-lens"
      data-frame={index}
    >
      <div className="pd-lens__head">
        <span className="pd-eyebrow">Promise Lens</span>
        <span className="pd-mono pd-dim">
          pd-1 · {frame.date}
        </span>
      </div>

      {/* Phase rail */}
      <ol className="pd-lens__phases" aria-hidden="true">
        {FRAMES.map((f, i) => (
          <li
            key={f.phase}
            className={cxLens(i <= index)}
            style={{ ["--phase-color" as string]: lensPhaseColor(i) }}
          />
        ))}
      </ol>

      <div className="pd-lens__body">
        <div className="pd-lens__phase">{frame.phase}</div>

        <p className="pd-lens__quote pd-quote" data-testid="lens-quote">
          <span className="pd-lens__quote-mark" aria-hidden="true">
            “
          </span>
          {highlight(frame.quote, frame.removed, frame.added)}
        </p>

        <p className="pd-lens__note pd-muted">{frame.note}</p>

        <div className="pd-lens__verdicts">
          <div className="pd-lens__verdict">
            <span className="pd-lens__verdict-label">Delivery</span>
            <StatusChip value={frame.delivery} kind="delivery" size="lg" />
          </div>
          <div className="pd-lens__verdict">
            <span className="pd-lens__verdict-label">Integrity</span>
            <StatusChip value={frame.integrity} kind="integrity" size="lg" />
          </div>
        </div>
      </div>

      <div className="pd-lens__controls">
        <button
          type="button"
          className="pd-lens__btn"
          onClick={prev}
          aria-label="Previous step"
          data-testid="lens-prev"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <div className="pd-lens__dots" role="tablist" aria-label="Timeline step">
          {FRAMES.map((f, i) => (
            <button
              key={f.phase}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${f.phase}, ${f.date}`}
              className={cxLensDot(i === index)}
              style={{ ["--phase-color" as string]: lensPhaseColor(i) }}
              onClick={() => setIndex(i)}
              data-testid={`lens-dot-${i}`}
            />
          ))}
        </div>

        <button
          type="button"
          className="pd-lens__btn"
          onClick={next}
          aria-label="Next step"
          data-testid="lens-next"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Announced for assistive tech without being a noisy live region. */}
      <p className="pd-sr" aria-live="polite">
        Step {index + 1} of {FRAMES.length}: {frame.phase}. Delivery {frame.delivery},
        integrity {frame.integrity}.
      </p>
    </div>
  );
}

function cxLens(done: boolean): string {
  return done ? "pd-lens__phase-dot pd-lens__phase-dot--done" : "pd-lens__phase-dot";
}

function cxLensDot(active: boolean): string {
  return active ? "pd-lens__dot pd-lens__dot--active" : "pd-lens__dot";
}

const PHASE_COLORS = ["var(--cobalt)", "var(--amber)", "var(--coral)", "var(--lime)"];

function lensPhaseColor(i: number): string {
  return PHASE_COLORS[i] ?? "var(--cobalt)";
}

export { FRAMES as LENS_FRAMES };