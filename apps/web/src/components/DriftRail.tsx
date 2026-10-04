/**
 * DriftRail — PromiseDecay's signature timeline.
 *
 * Shows the chronological lineage of a promise: the original, each later statement and
 * its semantic relationship, the delivery point, and the resolution. Only states actually
 * supported by evidence are shown — a step never appears unless it was recorded.
 *
 * Textual change is highlighted precisely: terms dropped from the original are marked as
 * removed, terms introduced later as added. That is the difference between "the promise
 * changed" and "here is exactly how".
 */
import {
  DELIVERY,
  INTEGRITY,
  LIFECYCLE,
  RELATION,
  isDelivery,
  isIntegrity,
  isLifecycle,
  type Delivery,
  type Integrity,
} from "@promisedecay/domain";
import { StatusChip, cx } from "./primitives";

export interface DriftEntry {
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  relationship: string;
}

export interface DriftRailProps {
  originalQuote: string;
  sourceUrl: string;
  createdTs: number;
  deadlineTs: number;
  drift: DriftEntry[];
  lifecycle: string;
  delivery: string | null;
  integrity: string | null;
}

const RELATION_COLOR: Record<string, string> = {
  SOFTENED: "var(--amber)",
  NARROWED: "var(--coral)",
  REFRAMED: "var(--orange)",
  REVERSED: "var(--red)",
  FULFILLED_EARLY: "var(--green)",
  UNRELATED: "var(--silver)",
};

const RELATION_NOTE: Record<string, string> = {
  SOFTENED: "wording softened",
  NARROWED: "scope narrowed",
  REFRAMED: "restated",
  REVERSED: "commitment reversed",
  FULFILLED_EARLY: "delivered early",
  UNRELATED: "later statement",
};

const STEP_COLOR: Record<string, string> = {
  ORIGINAL: "var(--cobalt)",
  DEADLINE: "var(--silver)",
  RESOLUTION: "var(--lime)",
};

/** Content words worth diffing; stopwords would produce noise, not insight. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "before", "by", "for", "from",
  "has", "have", "in", "is", "it", "its", "of", "on", "or", "our", "over", "that",
  "the", "their", "this", "to", "was", "we", "will", "with", "within", "would", "you",
]);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w)
  );
}

/**
 * Words present in the original that are absent from a later statement.
 *
 * Compared against the whole preceding lineage rather than a single step, so a term
 * dropped two statements ago still reads as dropped.
 */
function droppedWords(original: string, laterStatements: string[]): Set<string> {
  const later = new Set(contentWords(laterStatements.join(" ")));
  const out = new Set<string>();
  for (const word of contentWords(original)) {
    if (!later.has(word)) out.add(word);
  }
  return out;
}

/** Words that appear in this statement but were not in the original. */
function addedWords(original: string, statement: string): Set<string> {
  const orig = new Set(contentWords(original));
  const out = new Set<string>();
  for (const word of contentWords(statement)) {
    if (!orig.has(word)) out.add(word);
  }
  return out;
}

/**
 * Wrap a statement so removed/added terms are marked inline.
 *
 * Implemented with plain token splitting rather than dangerouslySetInnerHTML: user text is
 * untrusted, and nothing here ever becomes markup.
 */
function markChanges(
  text: string,
  removed: Set<string>,
  added: Set<string>
): React.ReactNode[] {
  const tokens = text.split(/(\s+)/);
  return tokens.map((token, i) => {
    const bare = token.toLowerCase().replace(/[^a-z'-]/g, "");
    if (bare.length <= 2) return token;
    if (removed.has(bare)) {
      return (
        <span className="pd-diff-removed" key={i}>
          {token}
        </span>
      );
    }
    if (added.has(bare)) {
      return (
        <span className="pd-diff-added" key={i}>
          {token}
        </span>
      );
    }
    return token;
  });
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function DriftRail({
  originalQuote,
  sourceUrl,
  createdTs,
  deadlineTs,
  drift,
  lifecycle,
  delivery,
  integrity,
}: DriftRailProps) {
  const sorted = [...drift].sort((a, b) => a.submittedTs - b.submittedTs);

  const allLater = sorted.map((d) => d.statement);
  const removedFromOriginal = droppedWords(originalQuote, allLater);

  return (
    <ol className="pd-rail" data-testid="drift-rail">
      {/* --- Original promise ------------------------------------------------------ */}
      <li
        className="pd-rail__step pd-rail__step--origin"
        style={{ ["--step-color" as string]: STEP_COLOR.ORIGINAL }}
        data-testid="drift-step-original"
      >
        <span className="pd-rail__node" aria-hidden="true" />
        <div className="pd-rail__date">{formatDate(createdTs)}</div>
        <div className="pd-rail__label">Original</div>
        <p className="pd-rail__statement pd-quote">“{originalQuote}”</p>
        <a
          className="pd-rail__source"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer noopener nofollow"
        >
          View original source ↗
        </a>
      </li>

      {/* --- Later statements ------------------------------------------------------ */}
      {sorted.map((entry, i) => {
        const color = RELATION_COLOR[entry.relationship] ?? "var(--silver)";
        const removed = droppedWords(
          [originalQuote, ...sorted.slice(0, i).map((d) => d.statement)].join(" "),
          [entry.statement]
        );
        const added = addedWords(
          [originalQuote, ...sorted.slice(0, i).map((d) => d.statement)].join(" "),
          entry.statement
        );

        return (
          <li
            className="pd-rail__step"
            key={`${entry.submittedTs}-${i}`}
            style={{ ["--step-color" as string]: color }}
            data-testid="drift-step"
            data-relationship={entry.relationship}
          >
            <span className="pd-rail__node" aria-hidden="true" />
            <div className="pd-rail__date">{formatDate(entry.submittedTs)}</div>
            <div className="pd-rail__label">
              {entry.relationship.replace(/_/g, " ")}
              <span style={{ color: "var(--text-tertiary)", letterSpacing: 0, textTransform: "none", fontWeight: 500 }}>
                · {RELATION_NOTE[entry.relationship] ?? "later statement"}
              </span>
            </div>
            <p className="pd-rail__statement">
              “{markChanges(entry.statement, removed, added)}”
            </p>
            <a
              className="pd-rail__source"
              href={entry.sourceUrl}
              target="_blank"
              rel="noreferrer noopener nofollow"
            >
              View source ↗
            </a>
          </li>
        );
      })}

      {/* --- Deadline -------------------------------------------------------------- */}
      <li
        className="pd-rail__step"
        style={{ ["--step-color" as string]: STEP_COLOR.DEADLINE }}
        data-testid="drift-step-deadline"
      >
        <span className="pd-rail__node" aria-hidden="true" />
        <div className="pd-rail__date">{formatDate(deadlineTs)}</div>
        <div className="pd-rail__label" style={{ color: "var(--text-secondary)" }}>
          Deadline
        </div>
        <p className="pd-rail__statement pd-muted">
          The commitment date passed. Resolution could now be requested by anyone.
        </p>
      </li>

      {/* --- Resolution — only when a verdict actually exists ---------------------- */}
      {delivery && integrity && isDelivery(delivery) && isIntegrity(integrity) ? (
        <li
          className="pd-rail__step"
          style={
            { "--step-color": delivery === DELIVERY.UNRESOLVED ? "var(--silver)" : "var(--lime)" } as React.CSSProperties
          }
          data-testid="drift-step-resolution"
        >
          <span className="pd-rail__node" aria-hidden="true" />
          <div className="pd-rail__date">
            {isLifecycle(lifecycle) && lifecycle === LIFECYCLE.FINAL ? "Final" : "Provisional"}
          </div>
          <div className="pd-rail__label">Resolution</div>
          <div
            className="pd-row pd-wrap"
            style={{ gap: 8, marginTop: 4 }}
          >
            <StatusChip value={delivery as Delivery} kind="delivery" size="lg" />
            <StatusChip value={integrity as Integrity} kind="integrity" size="lg" />
          </div>
          <p className="pd-muted" style={{ marginTop: 10, fontSize: "0.92rem" }}>
            Decided by GenLayer consensus over the evidence on record.
          </p>
        </li>
      ) : null}
    </ol>
  );
}

export { markChanges, droppedWords, addedWords, RELATION, cx };