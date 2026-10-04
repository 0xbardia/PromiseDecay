/**
 * Living Glass primitives.
 *
 * Each component is built so that glass carries information and colour carries state —
 * never as decoration on every container.
 */
import type { ReactNode } from "react";
import {
  DELIVERY,
  INTEGRITY,
  LIFECYCLE,
  RELATION,
  isDelivery,
  isIntegrity,
  isLifecycle,
  promiseRef,
  shortAddress,
  type Delivery,
  type Integrity,
  type Lifecycle,
} from "@promisedecay/domain";

export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------------------

const DELIVERY_COLOR: Record<Delivery, string> = {
  KEPT: "var(--status-kept)",
  KEPT_LATE: "var(--status-kept-late)",
  PARTIAL: "var(--status-partial)",
  NOT_KEPT: "var(--status-not-kept)",
  UNRESOLVED: "var(--status-unresolved)",
};

const INTEGRITY_COLOR: Record<Integrity, string> = {
  UNCHANGED: "var(--integrity-unchanged)",
  NARROWED: "var(--integrity-narrowed)",
  REFRAMED: "var(--integrity-reframed)",
  REVERSED: "var(--integrity-reversed)",
  UNKNOWN: "var(--integrity-unknown)",
};

const LIFECYCLE_COLOR: Record<Lifecycle, string> = {
  OPEN: "var(--lifecycle-open)",
  DUE: "var(--lifecycle-due)",
  RESOLVING: "var(--lifecycle-resolving)",
  PROVISIONAL: "var(--lifecycle-provisional)",
  CHALLENGE_WINDOW: "var(--lifecycle-challenge-window)",
  FINAL: "var(--lifecycle-final)",
};

const RELATION_COLOR: Record<string, string> = {
  SOFTENED: "var(--amber)",
  NARROWED: "var(--coral)",
  REFRAMED: "var(--orange)",
  REVERSED: "var(--red)",
  FULFILLED_EARLY: "var(--green)",
  UNRELATED: "var(--silver)",
};

const DELIVERY_HINT: Record<Delivery, string> = {
  KEPT: "Delivered in full by the deadline.",
  KEPT_LATE: "Delivered in full, but after the deadline.",
  PARTIAL: "Delivered only in part, or only to part of the promised audience.",
  NOT_KEPT: "Not delivered.",
  UNRESOLVED: "The evidence does not establish what happened.",
};

const INTEGRITY_HINT: Record<Integrity, string> = {
  UNCHANGED: "The promise kept its original meaning and scope.",
  NARROWED: "The scope was reduced after the promise was made.",
  REFRAMED: "The promise was restated to mean something else.",
  REVERSED: "The commitment was withdrawn or inverted.",
  UNKNOWN: "The evidence does not establish what happened to the commitment itself.",
};

/** Human phrasing for a lifecycle state, used in labels and descriptions. */
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  OPEN: "Open",
  DUE: "Due",
  RESOLVING: "Resolving",
  PROVISIONAL: "Provisional",
  CHALLENGE_WINDOW: "In challenge window",
  FINAL: "Final",
};

export function deliveryColor(value: string | null | undefined): string {
  return isDelivery(String(value)) ? DELIVERY_COLOR[value as Delivery] : "var(--silver)";
}

export function integrityColor(value: string | null | undefined): string {
  return isIntegrity(String(value)) ? INTEGRITY_COLOR[value as Integrity] : "var(--silver)";
}

export function lifecycleColor(value: string | null | undefined): string {
  return isLifecycle(String(value)) ? LIFECYCLE_COLOR[value as Lifecycle] : "var(--silver)";
}

// ---------------------------------------------------------------------------------------
// GlassSurface
// ---------------------------------------------------------------------------------------

export function GlassSurface({
  children,
  className,
  tone = "default",
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "light" | "heavy" | "flat";
  as?: "div" | "section" | "article" | "aside" | "li";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx("pd-glass", tone !== "default" && `pd-glass--${tone}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------------------
// StatusChip — colour AND text, never colour alone.
// ---------------------------------------------------------------------------------------

export function StatusChip({
  value,
  kind,
  size = "md",
  hint,
}: {
  value: string;
  kind: "delivery" | "integrity" | "lifecycle" | "relation";
  size?: "md" | "lg";
  hint?: string;
}) {
  const color =
    kind === "delivery"
      ? deliveryColor(value)
      : kind === "integrity"
        ? integrityColor(value)
        : kind === "lifecycle"
          ? lifecycleColor(value)
          : (RELATION_COLOR[value] ?? "var(--silver)");

  const label =
    kind === "lifecycle" ? LIFECYCLE_LABEL[value as Lifecycle] ?? value : value;

  const title =
    hint ??
    (kind === "delivery" ? DELIVERY_HINT[value as Delivery] : undefined) ??
    (kind === "integrity" ? INTEGRITY_HINT[value as Integrity] : undefined);

  return (
    <span
      className={cx("pd-chip", size === "lg" && "pd-chip--lg")}
      style={{ ["--chip-color" as string]: color }}
      title={title}
    >
      <span className="pd-chip__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------------------
// Brand mark + navigation
// ---------------------------------------------------------------------------------------

export function BrandMark() {
  return <span className="pd-brandmark" aria-hidden="true" />;
}

const NAV_LINKS = [
  { to: "/explore", label: "Explore" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/docs", label: "Docs" },
  { to: "/roadmap", label: "Roadmap" },
  { to: "https://github.com/0xbardia/PromiseDecay", label: "GitHub", external: true },
];

export function GlassNavigation({
  pathname,
  walletSlot,
}: {
  pathname: string;
  walletSlot?: ReactNode;
}) {
  const isActive = (to: string) =>
    to.startsWith("/") && (pathname === to || pathname.startsWith(`${to}/`));

  return (
    <header className="pd-nav">
      <div className="pd-shell pd-shell--wide pd-nav__inner">
        <a href="/" className="pd-nav__brand" aria-label="PromiseDecay home">
          <BrandMark />
          <span>PromiseDecay</span>
        </a>

        {/* Desktop links; on mobile the same list becomes the menu panel. */}
        <nav className="pd-nav__links" id="pd-nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.to}
                className="pd-nav__link"
                href={link.to}
                target="_blank"
                rel="noreferrer noopener"
              >
                {link.label}
              </a>
            ) : (
              <a
                key={link.to}
                className="pd-nav__link"
                href={link.to}
                {...(isActive(link.to) ? { "aria-current": "page" as const } : {})}
              >
                {link.label}
              </a>
            )
          )}
          {walletSlot ? <div className="pd-nav__cta">{walletSlot}</div> : null}
        </nav>

        <a href="/record" className="pd-btn pd-btn--primary pd-btn--sm pd-nav__record">
          Record a promise
        </a>

        <button
          type="button"
          className="pd-nav__burger"
          aria-label="Open menu"
          aria-expanded="false"
          aria-controls="pd-nav-links"
          data-testid="nav-burger"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------------------
// PromiseCard — the signature component
// ---------------------------------------------------------------------------------------

export interface PromiseCardData {
  promiseId: string;
  project: string;
  originalQuote: string;
  deadlineTs: number;
  lifecycle: string;
  delivery: string | null;
  integrity: string | null;
  sourceUrl?: string;
  createdTs?: number;
  driftCount?: number;
  evidenceCount?: number;
}

function formatDeadline(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PromiseCard({ promise, priority = false }: { promise: PromiseCardData; priority?: boolean }) {
  // The card's edge colour is the delivery state when known, otherwise the lifecycle.
  const accent = promise.delivery
    ? deliveryColor(promise.delivery)
    : lifecycleColor(promise.lifecycle);

  return (
    <article
      className="pd-card"
      style={{ ["--card-accent" as string]: accent }}
      data-testid="promise-card"
      data-promise-id={promise.promiseId}
    >
      <span className="pd-card__edge" aria-hidden="true" />

      <div className="pd-card__head">
        <div className="pd-grow">
          {/*
            One link, stretched over the whole card via CSS.

            Previously only a small "View record" button was a link, so clicking anywhere else
            on a card did nothing at all — which is not what anyone expects from a feed of
            records. The link is still a single tab stop with a single accessible name, and
            the `::after` overlay is raised above it so nested controls keep working.
          */}
          <a
            className="pd-card__project pd-card__link"
            href={`/promises/${promise.promiseId}`}
            data-testid="promise-card-open"
          >
            {promise.project}
            <span className="pd-sr-only"> — open this promise</span>
          </a>
          <span className="pd-card__id pd-mono pd-dim">{promiseRef(promise.promiseId)}</span>
        </div>
        <StatusChip value={promise.lifecycle} kind="lifecycle" />
      </div>

      <div className="pd-card__quote">
        <p className="pd-quote">“{promise.originalQuote}”</p>
      </div>

      <div className="pd-card__statuses">
        <StatusChip value={promise.delivery ?? DELIVERY.UNRESOLVED} kind="delivery" />
        <StatusChip value={promise.integrity ?? INTEGRITY.UNKNOWN} kind="integrity" />
      </div>

      <div className="pd-card__meta">
        <span>
          Deadline <strong className="pd-mono">{formatDeadline(promise.deadlineTs)}</strong>
        </span>
        {typeof promise.driftCount === "number" && promise.driftCount > 0 ? (
          <span>{promise.driftCount} drift {promise.driftCount === 1 ? "entry" : "entries"}</span>
        ) : null}
        {typeof promise.evidenceCount === "number" && promise.evidenceCount > 0 ? (
          <span>{promise.evidenceCount} evidence</span>
        ) : null}
      </div>

      <div className="pd-card__foot">
        <a
          className="pd-btn pd-btn--secondary pd-btn--sm"
          href={`/promises/${promise.promiseId}`}
          // Starts with the visible text so the accessible name contains it (WCAG 2.5.3),
          // then adds the id so several cards in a feed are distinguishable out of context.
          aria-label={`View record ${promiseRef(promise.promiseId)}`}
          data-testid="promise-card-link"
        >
          View record
        </a>
        {priority && promise.sourceUrl ? (
          <a
            className="pd-mono pd-dim pd-inner-link"
            href={promise.sourceUrl}
            target="_blank"
            rel="noreferrer noopener nofollow"
          >
            source ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------
// PromiseSkeleton — designed loading, never a bare spinner.
// ---------------------------------------------------------------------------------------

export function PromiseSkeleton() {
  return (
    <article className="pd-card" aria-hidden="true" data-testid="promise-skeleton">
      <span className="pd-card__edge" />
      <div className="pd-card__head">
        <div className="pd-grow pd-stack" style={{ gap: 7 }}>
          <div className="pd-skeleton" style={{ height: 15, width: "42%" }} />
          <div className="pd-skeleton" style={{ height: 11, width: "24%" }} />
        </div>
        <div className="pd-skeleton" style={{ height: 24, width: 92, borderRadius: 999 }} />
      </div>
      <div className="pd-card__quote pd-stack" style={{ gap: 8 }}>
        <div className="pd-skeleton" style={{ height: 17, width: "96%" }} />
        <div className="pd-skeleton" style={{ height: 17, width: "88%" }} />
        <div className="pd-skeleton" style={{ height: 17, width: "54%" }} />
      </div>
      <div className="pd-card__statuses">
        <div className="pd-skeleton" style={{ height: 24, width: 92, borderRadius: 999 }} />
        <div className="pd-skeleton" style={{ height: 24, width: 104, borderRadius: 999 }} />
      </div>
      <div className="pd-card__meta">
        <div className="pd-skeleton" style={{ height: 12, width: 132 }} />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------------------

export function EmptyState({
  title,
  body,
  action,
  icon = "◎",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="pd-empty pd-glass" data-testid="empty-state">
      <span className="pd-empty__mark" aria-hidden="true">
        <span style={{ fontSize: 22 }}>{icon}</span>
      </span>
      <h3>{title}</h3>
      <p className="pd-muted" style={{ maxWidth: "46ch" }}>
        {body}
      </p>
      {action}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "success";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const color =
    tone === "error"
      ? "var(--red)"
      : tone === "warn"
        ? "var(--amber)"
        : tone === "success"
          ? "var(--green)"
          : "var(--cobalt)";

  return (
    <div
      className="pd-notice"
      style={{ ["--notice-color" as string]: color }}
      role={tone === "error" ? "alert" : "status"}
      data-testid={`notice-${tone}`}
    >
      <div className="pd-grow">
        {title ? <div className="pd-notice__title">{title}</div> : null}
        <div className="pd-notice__body">{children}</div>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------------------

export function MonoId({ children }: { children: ReactNode }) {
  return <span className="pd-mono">{children}</span>;
}

export function Submitter({ address, verified }: { address: string; verified?: boolean }) {
  // Never claim authority that has not been verified.
  const label = verified
    ? `Verified response from ${shortAddress(address)}`
    : `Response from ${shortAddress(address)}`;
  return (
    <span className="pd-mono pd-dim" title={label}>
      {label}
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="pd-section__head">
      <p className="pd-eyebrow" style={{ marginBottom: 12 }}>
        {eyebrow}
      </p>
      <h2>{title}</h2>
      {body ? (
        <p className="pd-muted" style={{ marginTop: 14, fontSize: "1.06rem", maxWidth: "62ch" }}>
          {body}
        </p>
      ) : null}
    </div>
  );
}

export { DELIVERY, INTEGRITY, LIFECYCLE, RELATION, promiseRef, shortAddress };