/**
 * /explore — searchable, filterable promise feed with cursor pagination.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DELIVERY,
  DELIVERY_VALUES,
  LIFECYCLE,
  LIFECYCLE_VALUES,
} from "@promisedecay/domain";
import {
  EmptyState,
  Notice,
  PromiseCard,
  PromiseSkeleton,
} from "../components/primitives";
import { ApiClientError, api, type ApiPromise } from "../lib/api";
import { deliveryColor, lifecycleColor } from "../components/primitives";

type FeedState = "loading" | "ready" | "error" | "empty";

export function Explore() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [lifecycle, setLifecycle] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);

  const [items, setItems] = useState<ApiPromise[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<FeedState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const firstLoad = useRef(true);

  // Debounce the search box into `submitted`.
  //
  // The field only ever applied a query on form submit, and the form has no visible submit
  // control — so typing did nothing and a user who typed and waited was looking at an
  // unresponsive page with no way to tell why. Search worked; it was simply unreachable for
  // anyone who did not happen to press Enter.
  //
  // 300ms is long enough that a normal phrase is one request rather than one per keystroke,
  // and short enough that the result still feels like the list reacting as you type. Pressing
  // Enter still applies immediately rather than waiting out the timer.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === submitted) return;
    const t = setTimeout(() => setSubmitted(trimmed), 300);
    return () => clearTimeout(t);
  }, [query, submitted]);

  const load = useCallback(
    async (nextCursor: string | null, mode: "replace" | "append") => {
      if (mode === "append") setLoadingMore(true);
      else setState("loading");
      setError(null);
      try {
        const params = {
          limit: 12,
          ...(submitted ? { q: submitted } : {}),
          ...(lifecycle ? { lifecycle } : {}),
          ...(delivery ? { delivery } : {}),
          ...(nextCursor ? { cursor: nextCursor } : {}),
        };
        const page = submitted
          ? await api.search({ ...params, q: submitted })
          : await api.listPromises(params);

        setItems((prev) => (mode === "append" ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setState(page.items.length === 0 && mode === "replace" ? "empty" : "ready");
      } catch (err) {
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load promises. Check your connection and try again."
        );
        setState("error");
      } finally {
        setLoadingMore(false);
        firstLoad.current = false;
      }
    },
    [submitted, lifecycle, delivery]
  );

  useEffect(() => {
    void load(null, "replace");
  }, [load]);

  const activeFilters = useMemo(
    () => [lifecycle, delivery].filter(Boolean).length + (submitted ? 1 : 0),
    [lifecycle, delivery, submitted]
  );

  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
      <div className="pd-shell pd-shell--wide">
        <header style={{ marginBottom: 26 }}>
          <p className="pd-eyebrow">Explore</p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", margin: "10px 0 12px" }}>
            Public commitments
          </h1>
          <p className="pd-muted" style={{ maxWidth: "58ch", fontSize: "1.02rem" }}>
            Every promise recorded on chain, with its delivery and integrity decided by
            GenLayer consensus. Browse without connecting a wallet.
          </p>
        </header>

        {/* ------------------------------------------------------------- filters -- */}
        <div className="pd-filters" role="search">
          <form
            className="pd-filters__search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              // Apply at once rather than waiting out the debounce, so Enter still feels
              // immediate for someone who reaches for it.
              setSubmitted(query.trim());
            }}
          >
            <label className="pd-sr" htmlFor="pd-search">
              Search promises
            </label>
            <input
              id="pd-search"
              className="pd-input"
              type="search"
              placeholder="Search projects and promises…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-describedby="pd-search-status"
              data-testid="explore-search"
            />
            {/* Announce the result count, so the search is legible to a screen reader and
                visible to everyone as soon as typing starts doing something. */}
            <p
              id="pd-search-status"
              className="pd-muted"
              role="status"
              aria-live="polite"
              data-testid="explore-search-status"
              style={{ fontSize: "0.82rem" }}
            >
              {submitted
                ? state === "loading"
                  ? "Searching…"
                  : state === "empty"
                    ? `No promises match “${submitted}”.`
                    : `${items.length} result${items.length === 1 ? "" : "s"} for “${submitted}”.`
                : ""}
            </p>
          </form>

          <div className="pd-chip-row" role="group" aria-label="Filter by lifecycle">
            {LIFECYCLE_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                className="pd-filter-chip"
                aria-pressed={lifecycle === v}
                style={{ ["--filter-color" as string]: lifecycleColor(v) }}
                onClick={() => setLifecycle((cur) => (cur === v ? null : v))}
                data-testid={`filter-lifecycle-${v}`}
              >
                {v === LIFECYCLE.CHALLENGE_WINDOW ? "Challenge window" : v.toLowerCase()}
              </button>
            ))}
          </div>

          <div className="pd-chip-row" role="group" aria-label="Filter by delivery">
            {DELIVERY_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                className="pd-filter-chip"
                aria-pressed={delivery === v}
                style={{ ["--filter-color" as string]: deliveryColor(v) }}
                onClick={() => setDelivery((cur) => (cur === v ? null : v))}
                data-testid={`filter-delivery-${v}`}
              >
                {v.replace("_", " ").toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {activeFilters > 0 ? (
          <div className="pd-row" style={{ gap: 12, marginTop: 14 }}>
            <span className="pd-muted" style={{ fontSize: "0.86rem" }}>
              {activeFilters} filter{activeFilters === 1 ? "" : "s"} active
            </span>
            <button
              type="button"
              className="pd-btn pd-btn--ghost pd-btn--sm"
              onClick={() => {
                setQuery("");
                setSubmitted("");
                setLifecycle(null);
                setDelivery(null);
              }}
              data-testid="clear-filters"
            >
              Clear filters
            </button>
          </div>
        ) : null}

        {/* ---------------------------------------------------------------- feed -- */}
        <div style={{ marginTop: 26 }}>
          {state === "error" ? (
            <Notice
              tone="error"
              title="Could not load promises"
              action={
                <button
                  type="button"
                  className="pd-btn pd-btn--secondary pd-btn--sm"
                  onClick={() => void load(null, "replace")}
                >
                  Retry
                </button>
              }
            >
              {error}
            </Notice>
          ) : state === "empty" ? (
            <EmptyState
              title={submitted ? `No promises match “${submitted}”` : "No promises recorded yet"}
              body={
                submitted
                  ? "Try a different term, or clear the filters to see everything on chain."
                  : "Nothing is indexed on this deployment so far. The first record starts the history."
              }
              icon="⌕"
              action={
                submitted || activeFilters ? (
                  <button
                    type="button"
                    className="pd-btn pd-btn--secondary"
                    onClick={() => {
                      setQuery("");
                      setSubmitted("");
                      setLifecycle(null);
                      setDelivery(null);
                    }}
                  >
                    Clear search
                  </button>
                ) : (
                  <a className="pd-btn pd-btn--primary" href="/record">
                    Record a promise
                  </a>
                )
              }
            />
          ) : state === "loading" ? (
            <div className="pd-grid pd-grid--cards" data-testid="explore-skeletons">
              <PromiseSkeleton />
              <PromiseSkeleton />
              <PromiseSkeleton />
              <PromiseSkeleton />
              <PromiseSkeleton />
              <PromiseSkeleton />
            </div>
          ) : (
            <>
              <div className="pd-grid pd-grid--cards" data-testid="explore-grid">
                {items.map((p) => (
                  <PromiseCard key={p.promiseId} promise={p} />
                ))}
              </div>

              {cursor ? (
                <div style={{ display: "grid", placeItems: "center", marginTop: 28 }}>
                  <button
                    type="button"
                    className="pd-btn pd-btn--secondary"
                    disabled={loadingMore}
                    onClick={() => void load(cursor, "append")}
                    data-testid="load-more"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              ) : (
                <p
                  className="pd-dim"
                  style={{ textAlign: "center", marginTop: 28, fontSize: "0.88rem" }}
                >
                  That is every promise indexed on chain.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export { DELIVERY };