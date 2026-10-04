/**
 * /promises/:id — the promise detail page.
 *
 * The most important screen in the product. Hierarchy is deliberate:
 *   Original Promise first (visual priority), then Promise DNA, then the drift lineage,
 *   then evidence and responses, then the GenLayer resolution, then challenge history and
 *   on-chain provenance. Technical data is progressively disclosed, never dumped raw.
 */
import { useCallback, useEffect, useState } from "react";
import {
  DELIVERY,
  INTEGRITY,
  LIFECYCLE,
  promiseRef,
  shortAddress,
} from "@promisedecay/domain";
import { DriftRail } from "../components/DriftRail";
import {
  EmptyState,
  GlassSurface,
  Notice,
  StatusChip,
  Submitter,
  cx,
  deliveryColor,
  integrityColor,
} from "../components/primitives";
import { ApiClientError, api, type ApiPromiseDetail } from "../lib/api";
import { CONTRACT_ADDRESS, NETWORK_NAME } from "../lib/chain";

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PromiseDetail({ params }: { params: Record<string, string> }) {
  const id = params.id ?? "";
  const [data, setData] = useState<ApiPromiseDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [error, setError] = useState<string | null>(null);
  const [showProvenance, setShowProvenance] = useState(false);

  const load = useCallback(() => {
    if (!/^\d+$/.test(id)) {
      setState("missing");
      return;
    }
    setState("loading");
    api
      .getPromise(id)
      .then((d) => {
        setData(d);
        setState("ready");
      })
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 404) setState("missing");
        else {
          setError(err instanceof ApiClientError ? err.message : "Could not load this promise.");
          setState("error");
        }
      });
  }, [id]);

  useEffect(load, [load]);

  if (state === "missing") {
    return (
      <section className="pd-section">
        <div className="pd-shell">
          <EmptyState
            title={/^\d+$/.test(id) ? `Promise ${promiseRef(id)} was not found` : "Invalid promise id"}
            body={
              /^\d+$/.test(id)
                ? "No record with this id is indexed on this deployment. It may exist on a different contract address."
                : "A promise id is a positive integer, like pd-1."
            }
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

  if (state === "error") {
    return (
      <section className="pd-section">
        <div className="pd-shell">
          <Notice
            tone="error"
            title="Could not load this promise"
            action={
              <button type="button" className="pd-btn pd-btn--secondary pd-btn--sm" onClick={load}>
                Retry
              </button>
            }
          >
            {error}
          </Notice>
        </div>
      </section>
    );
  }

  if (state === "loading" || !data) {
    return (
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <div className="pd-skeleton" style={{ height: 16, width: 180, marginBottom: 22 }} />
          <div className="pd-skeleton" style={{ height: 128, marginBottom: 18 }} />
          <div className="pd-skeleton" style={{ height: 320 }} />
        </div>
      </section>
    );
  }

  const delivery = data.delivery;
  const integrity = data.integrity;
  const hasResolution = Boolean(delivery && integrity);
  const resolutionColor = delivery ? deliveryColor(delivery) : "var(--silver)";
  const isFinal = data.lifecycle === LIFECYCLE.FINAL;

  return (
    <>
      {/* -------------------------------------------------------- original promise */}
      <section className="pd-section" style={{ paddingBlock: "clamp(28px, 4vw, 52px)" }}>
        <div className="pd-shell pd-shell--wide">
          <nav aria-label="Breadcrumb" className="pd-mono pd-dim" style={{ marginBottom: 22, fontSize: "0.8rem" }}>
            <a href="/explore" style={{ color: "var(--sky)" }}>
              promises
            </a>
            <span aria-hidden="true"> / </span>
            <span>{promiseRef(data.promiseId)}</span>
          </nav>

          <GlassSurface
            tone="heavy"
            className="pd-glass__pad"
            style={{
              borderColor: `color-mix(in srgb, ${resolutionColor} 34%, var(--glass-edge))`,
            }}
          >
            <div
              className="pd-row pd-wrap"
              style={{ justifyContent: "space-between", gap: 12, marginBottom: 18 }}
            >
              {/* The promise id is the page's identity, so it is the h1: assistive
                  technology and search engines both need a real top-level heading, and
                  "Helios Data" alone would repeat across a project's promises. */}
              <h1 className="pd-mono" style={{ fontSize: "0.95rem", fontWeight: 640, margin: 0 }}>
                <a
                  href={`/projects/${data.projectSlug}`}
                  style={{ fontWeight: 640, letterSpacing: "-0.015em" }}
                  data-testid="detail-project"
                >
                  {data.project}
                </a>{" "}
                <span className="pd-dim">{promiseRef(data.promiseId)}</span>
              </h1>
              <StatusChip value={data.lifecycle} kind="lifecycle" />
            </div>

            {/* The original promise gets the visual priority on this page. */}
            <p className="pd-quote" style={{ fontSize: "clamp(1.3rem, 2.7vw, 2rem)", lineHeight: 1.34 }}>
              “{data.originalQuote}”
            </p>

            <div className="pd-row pd-wrap" style={{ gap: 10, marginTop: 20 }}>
              <span className="pd-muted" style={{ fontSize: "0.9rem" }}>
                Recorded {formatDate(data.createdTs)} by{" "}
                <span className="pd-mono">{shortAddress(data.creator)}</span>
              </span>
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer noopener nofollow"
                style={{ color: "var(--sky)", fontSize: "0.9rem" }}
                data-testid="detail-source"
              >
                View original source ↗
              </a>
            </div>
          </GlassSurface>
        </div>
      </section>

      {/* ------------------------------------------------------------- resolution */}
      <section className="pd-section" style={{ paddingBlock: "0 clamp(40px, 6vw, 72px)" }}>
        <div className="pd-shell pd-shell--wide">
          {hasResolution ? (
            <div
              className="pd-resolution"
              style={{ ["--res-accent" as string]: resolutionColor }}
              data-testid="resolution-panel"
            >
              <div className="pd-row pd-wrap" style={{ justifyContent: "space-between", gap: 12 }}>
                <div>
                  <p className="pd-eyebrow">GenLayer resolution</p>
                  <p className="pd-muted" style={{ fontSize: "0.88rem", marginTop: 6 }}>
                    {isFinal ? "Final on chain" : "Provisional — open for challenge"} · decided{" "}
                    {formatDateTime(data.decidedTs)}
                  </p>
                </div>
                <StatusChip value={data.lifecycle} kind="lifecycle" size="lg" />
              </div>

              <div className="pd-resolution__grid">
                <div
                  className="pd-verdict"
                  style={{ ["--verdict-color" as string]: deliveryColor(delivery) }}
                >
                  <div className="pd-verdict__label">Delivery</div>
                  <div className="pd-verdict__value" data-testid="verdict-delivery">
                    {delivery!.replace("_", " ")}
                  </div>
                </div>
                <div
                  className="pd-verdict"
                  style={{ ["--verdict-color" as string]: integrityColor(integrity) }}
                >
                  <div className="pd-verdict__label">Promise integrity</div>
                  <div className="pd-verdict__value" data-testid="verdict-integrity">
                    {integrity}
                  </div>
                </div>
                <div className="pd-verdict" style={{ ["--verdict-color" as string]: "var(--silver)" }}>
                  <div className="pd-verdict__label">Deadline met</div>
                  <div className="pd-verdict__value">
                    {data.deadlineMet === null ? "—" : data.deadlineMet ? "Yes" : "No"}
                  </div>
                </div>
              </div>

              {data.explanation ? (
                <p className="pd-resolution__explanation" data-testid="resolution-explanation">
                  {data.explanation}
                </p>
              ) : null}

              <div className="pd-row pd-wrap" style={{ gap: 10, marginTop: 18 }}>
                {!isFinal ? (
                  <a
                    className="pd-btn pd-btn--secondary pd-btn--sm"
                    href={`/promises/${data.promiseId}/challenge`}
                    data-testid="challenge-cta"
                  >
                    Challenge this result
                  </a>
                ) : null}
                <a className="pd-btn pd-btn--ghost pd-btn--sm" href="/docs/consensus">
                  How consensus works
                </a>
              </div>
            </div>
          ) : (
            <GlassSurface className="pd-glass__pad" data-testid="no-resolution">
              <div className="pd-row pd-wrap" style={{ gap: 14, alignItems: "flex-start" }}>
                <div className="pd-grow">
                  <h3 style={{ fontSize: "1.08rem", marginBottom: 8 }}>No resolution yet</h3>
                  <p className="pd-muted" style={{ fontSize: "0.94rem", lineHeight: 1.6 }}>
                    A verdict appears here once the deadline has passed and GenLayer validators
                    have assessed the evidence. Anyone can request it, and anyone can challenge the
                    result inside the challenge window.
                  </p>
                </div>
                <a className="pd-btn pd-btn--secondary" href={`/promises/${data.promiseId}/evidence`}>
                  Add evidence
                </a>
              </div>
            </GlassSurface>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- drift */}
      <section className="pd-section" style={{ paddingBlock: "0 clamp(40px, 6vw, 72px)" }}>
        <div className="pd-shell pd-shell--wide">
          <div className="pd-split pd-split--top">
            <div>
              <p className="pd-eyebrow">Promise drift</p>
              <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2.1rem)", margin: "10px 0 12px" }}>
                How this promise changed
              </h2>
              <p className="pd-muted" style={{ fontSize: "0.97rem", lineHeight: 1.62 }}>
                The original above can never change. Everything after it is appended, so the
                lineage shows what was actually said at each point in time.
              </p>
              <div className="pd-row pd-wrap" style={{ gap: 10, marginTop: 18 }}>
                <a className="pd-btn pd-btn--secondary pd-btn--sm" href={`/promises/${data.promiseId}/update`}>
                  Add a later statement
                </a>
              </div>
            </div>

            <GlassSurface tone="heavy" className="pd-glass__pad">
              <DriftRail
                originalQuote={data.originalQuote}
                sourceUrl={data.sourceUrl}
                createdTs={data.createdTs}
                deadlineTs={data.deadlineTs}
                drift={data.drift}
                lifecycle={data.lifecycle}
                delivery={data.delivery}
                integrity={data.integrity}
              />
            </GlassSurface>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- evidence */}
      <section className="pd-section" style={{ paddingBlock: "0 clamp(40px, 6vw, 72px)" }}>
        <div className="pd-shell pd-shell--wide">
          <div className="pd-split pd-split--reverse">
            <div>
              <p className="pd-eyebrow">Promise DNA</p>
              <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2.1rem)", margin: "10px 0 16px" }}>
                What was committed
              </h2>
              <dl className="pd-kv">
                <dt>Project</dt>
                <dd>{data.project}</dd>
                <dt>Actor</dt>
                <dd>{data.actor}</dd>
                <dt>Action</dt>
                <dd>{data.action}</dd>
                <dt>Object</dt>
                <dd>{data.object}</dd>
                <dt>Scope</dt>
                <dd>{data.scope}</dd>
                <dt>Conditions</dt>
                <dd>{data.conditions || "None stated"}</dd>
                <dt>Deadline</dt>
                <dd>{formatDate(data.deadlineTs)}</dd>
                <dt>Recorded by</dt>
                <dd className="pd-mono">{data.creator}</dd>
              </dl>
            </div>

            <div className="pd-stack" style={{ gap: 14 }}>
              <GlassSurface className="pd-glass__pad" style={{ padding: 20 }}>
                <div className="pd-row" style={{ justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                  <h3 style={{ fontSize: "1.02rem" }}>
                    Evidence <span className="pd-dim">({data.evidence.length})</span>
                  </h3>
                  <a
                    className="pd-btn pd-btn--secondary pd-btn--sm"
                    href={`/promises/${data.promiseId}/evidence`}
                  >
                    Add
                  </a>
                </div>
                {data.evidence.length === 0 ? (
                  <p className="pd-muted" style={{ fontSize: "0.92rem" }}>
                    No evidence yet. Anyone can add a source that shows what was delivered.
                  </p>
                ) : (
                  <ul className="pd-stack" style={{ gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
                    {data.evidence.map((e, i) => (
                      <li key={`${e.submittedTs}-${i}`}>
                        <p style={{ fontSize: "0.94rem", lineHeight: 1.55 }}>“{e.quote}”</p>
                        <div className="pd-row pd-wrap" style={{ gap: 10, marginTop: 6 }}>
                          <span className="pd-chip pd-chip--neutral">
                            <span className="pd-chip__dot" aria-hidden="true" />
                            {e.kind}
                          </span>
                          <a
                            href={e.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener nofollow"
                            className="pd-mono pd-dim"
                            style={{ color: "var(--sky)", fontSize: "0.76rem" }}
                          >
                            source ↗
                          </a>
                          <span className="pd-mono pd-dim" style={{ fontSize: "0.74rem" }}>
                            {formatDate(e.submittedTs)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassSurface>

              <GlassSurface className="pd-glass__pad" style={{ padding: 20 }}>
                <div className="pd-row" style={{ justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                  <h3 style={{ fontSize: "1.02rem" }}>
                    Responses <span className="pd-dim">({data.responses.length})</span>
                  </h3>
                  <a
                    className="pd-btn pd-btn--secondary pd-btn--sm"
                    href={`/promises/${data.promiseId}/respond`}
                  >
                    Respond
                  </a>
                </div>
                {data.responses.length === 0 ? (
                  <p className="pd-muted" style={{ fontSize: "0.92rem" }}>
                    No responses yet. Anyone may respond; a response never rewrites the record.
                  </p>
                ) : (
                  <ul className="pd-stack" style={{ gap: 14, listStyle: "none", padding: 0, margin: 0 }}>
                    {data.responses.map((r, i) => (
                      <li key={`${r.submittedTs}-${i}`}>
                        <Submitter address={r.submitter} verified={r.verified} />
                        <p style={{ fontSize: "0.94rem", lineHeight: 1.55, marginTop: 4 }}>
                          {r.statement}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassSurface>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ provenance */}
      <section className="pd-section" style={{ paddingBlock: "0 clamp(40px, 6vw, 72px)" }}>
        <div className="pd-shell pd-shell--wide">
          <GlassSurface tone="flat" className="pd-glass__pad" style={{ padding: 20 }}>
            <button
              type="button"
              className="pd-row"
              onClick={() => setShowProvenance((v) => !v)}
              aria-expanded={showProvenance}
              style={{
                width: "100%",
                background: "none",
                border: 0,
                color: "inherit",
                cursor: "pointer",
                gap: 12,
                font: "inherit",
                textAlign: "left",
              }}
              data-testid="provenance-toggle"
            >
              <span className="pd-grow">
                <span style={{ fontWeight: 640, fontSize: "0.98rem" }}>On-chain provenance</span>
                <span className="pd-muted" style={{ display: "block", fontSize: "0.87rem", marginTop: 3 }}>
                  Contract address, network, contract version and indexing freshness.
                </span>
              </span>
              <span aria-hidden="true" style={{ color: "var(--text-tertiary)", transform: showProvenance ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>
                ▾
              </span>
            </button>

            {showProvenance ? (
              <dl className="pd-kv" style={{ marginTop: 18 }} data-testid="provenance-body">
                <dt>Promise id</dt>
                <dd className="pd-mono">{promiseRef(data.promiseId)}</dd>
                <dt>Contract</dt>
                <dd className="pd-mono">{CONTRACT_ADDRESS ?? "not configured"}</dd>
                <dt>Network</dt>
                <dd>{NETWORK_NAME}</dd>
                <dt>Contract version</dt>
                <dd className="pd-mono">{data.contractVersion}</dd>
                <dt>Indexing</dt>
                <dd>{formatDateTime(new Date(data.indexedAt).getTime() / 1000)}</dd>
                <dt>Challenge window</dt>
                <dd>
                  {data.challengeClosesAt
                    ? `closes ${formatDateTime(data.challengeClosesAt)}`
                    : "not started"}
                </dd>
              </dl>
            ) : null}
          </GlassSurface>
        </div>
      </section>
    </>
  );
}

export { DELIVERY, INTEGRITY, cx };