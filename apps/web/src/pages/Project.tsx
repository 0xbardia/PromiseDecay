/**
 * /projects/:slug — a project's full commitment history.
 */
import { useEffect, useState } from "react";
import { promiseRef, slugifyProject } from "@promisedecay/domain";
import {
  EmptyState,
  GlassSurface,
  Notice,
  PromiseCard,
  PromiseSkeleton,
  StatusChip,
} from "../components/primitives";
import { ApiClientError, api, type ApiProjectDetail } from "../lib/api";

export function Project({ params }: { params: Record<string, string> }) {
  const slug = params.slug ?? "";
  const [project, setProject] = useState<ApiProjectDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api
      .getProject(slug)
      .then((p) => {
        if (cancelled) return;
        setProject(p);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) setState("missing");
        else {
          setError(
            err instanceof ApiClientError ? err.message : "Could not load this project."
          );
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state === "missing") {
    return (
      <section className="pd-section">
        <div className="pd-shell">
          <EmptyState
            title="No such project"
            body={`Nothing is indexed under “${slug}”. It may not have recorded a promise on this deployment.`}
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
          <Notice tone="error" title="Could not load this project">
            {error}
          </Notice>
        </div>
      </section>
    );
  }

  if (state === "loading" || !project) {
    return (
      <section className="pd-section">
        <div className="pd-shell pd-shell--wide">
          <div className="pd-skeleton" style={{ height: 22, width: 220, marginBottom: 20 }} />
          <div className="pd-skeleton" style={{ height: 96, marginBottom: 22 }} />
          <div className="pd-grid pd-grid--cards">
            <PromiseSkeleton />
            <PromiseSkeleton />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
      <div className="pd-shell pd-shell--wide">
        <header style={{ marginBottom: 26 }}>
          <p className="pd-eyebrow">Project</p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", margin: "10px 0 8px" }}>
            {project.name}
          </h1>
          <p className="pd-muted" style={{ fontSize: "1rem" }}>
            {project.actor}
          </p>
        </header>

        {/* Counts describe the record, not a score: no trust number, no ranking. */}
        <GlassSurface tone="heavy" className="pd-glass__pad" style={{ marginBottom: 26 }}>
          <div
            className="pd-row pd-wrap"
            style={{ gap: "clamp(20px, 4vw, 52px)" }}
          >
            <Metric value={project.promiseCount} label="Promises recorded" />
            <Metric value={project.resolvedCount} label="With a resolution" />
            <Metric value={project.openCount} label="Still open" />
            <Metric value={project.finalCount} label="Finalized" />
          </div>
        </GlassSurface>

        <h2 style={{ fontSize: "clamp(1.3rem, 2.4vw, 1.75rem)", marginBottom: 16 }}>
          Commitment history
        </h2>

        {project.promises.length === 0 ? (
          <EmptyState
            title="No promises yet"
            body={`${project.name} has not recorded a public promise on this deployment.`}
            icon="◷"
          />
        ) : (
          <div className="pd-grid pd-grid--cards" data-testid="project-promises">
            {project.promises.map((p) => (
              <PromiseCard key={p.promiseId} promise={p} priority />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="pd-metric">
      <span className="pd-metric__value pd-mono">{value}</span>
      <span className="pd-metric__label">{label}</span>
    </div>
  );
}

export { promiseRef, slugifyProject, StatusChip };