/**
 * /docs and /docs/:slug — public documentation.
 *
 * Reading comfort comes first: generous measure, clear hierarchy, a sticky sidebar on
 * desktop and a horizontally scrollable nav on mobile, plus a table of contents.
 * The Living Glass language is present but stays out of the way.
 */
import { useEffect } from "react";
import { EmptyState } from "../components/primitives";
import { DOC_BODIES, DOC_ORDER, type DocBlock } from "../content/docs";

function RenderBlock({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "h3":
      return <h3>{block.text}</h3>;
    case "p":
      return <p>{block.text}</p>;
    case "code":
      return (
        <pre className="pd-code">
          <code>{block.text}</code>
        </pre>
      );
    case "list":
      return (
        <ul>
          {block.items?.map((item) => <li key={item}>{item}</li>)}
        </ul>
      );
    case "table":
      return (
        <table className="pd-table">
          <thead>
            <tr>
              {block.head?.map((h) => <th key={h} scope="col">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {block.rows?.map((row) => (
              <tr key={row.join("|")}>
                {row.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "callout":
      return (
        <div
          className="pd-callout"
          style={{
            ["--callout-color" as string]:
              block.tone === "warn" ? "var(--amber)" : block.tone === "error" ? "var(--red)" : "var(--cobalt)",
          }}
        >
          {block.text}
        </div>
      );
    default:
      return null;
  }
}

export function Docs({ params }: { params: Record<string, string> }) {
  const slug = params.slug ?? "";
  const doc = DOC_BODIES[slug];

  useEffect(() => {
    if (doc) document.title = `${doc.title} — PromiseDecay docs`;
    else document.title = "Documentation — PromiseDecay";
    return () => {
      document.title = "PromiseDecay — a public memory layer for promises";
    };
  }, [doc]);

  if (slug === "" || !doc) {
    return <DocsIndex />;
  }

  const meta = DOC_ORDER.find((d) => d.slug === slug);

  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(28px, 4vw, 52px)" }}>
      <div className="pd-shell pd-shell--wide">
        <nav aria-label="Breadcrumb" className="pd-mono pd-dim" style={{ marginBottom: 20, fontSize: "0.8rem" }}>
          <a href="/docs" style={{ color: "var(--sky)" }}>
            docs
          </a>
          <span aria-hidden="true"> / </span>
          <span>{doc.title}</span>
        </nav>

        <div className="pd-docs">
          <nav className="pd-docs__nav" aria-label="Documentation">
            {DOC_ORDER.map((d) => (
              <a
                key={d.slug}
                href={`/docs/${d.slug}`}
                {...(d.slug === slug ? { "aria-current": "page" as const } : {})}
              >
                {d.title}
              </a>
            ))}
          </nav>

          <article className="pd-prose">
            <header style={{ marginBottom: 8 }}>
              <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", marginBottom: 12 }}>
                {doc.title}
              </h1>
              {meta ? <p className="pd-muted">{meta.blurb}</p> : null}
            </header>

            {doc.sections.map((section) => (
              <section key={section.id} aria-labelledby={section.id}>
                <h2 id={section.id}>{section.heading}</h2>
                {section.blocks.map((block, i) => (
                  <RenderBlock key={`${section.id}-${i}`} block={block} />
                ))}
              </section>
            ))}

            <p className="pd-hint" style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.09)" }}>
              Source of truth: <span className="pd-mono">{meta?.source ?? "docs/"}</span> in the
              repository. These docs are written once and reused, so they cannot drift apart.
            </p>
          </article>

          <nav className="pd-docs__toc" aria-label="On this page">
            {doc.sections.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.heading}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}

function DocsIndex() {
  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
      <div className="pd-shell pd-shell--wide">
        <header style={{ maxWidth: "64ch", marginBottom: 34 }}>
          <p className="pd-eyebrow">Documentation</p>
          <h1 style={{ fontSize: "clamp(2.1rem, 4.4vw, 3.2rem)", margin: "10px 0 12px" }}>
            How PromiseDecay works
          </h1>
          <p className="pd-muted" style={{ fontSize: "1.04rem", lineHeight: 1.62 }}>
            The contract, the consensus model, the API and the security posture — written down
            rather than implied.
          </p>
        </header>

        <div className="pd-grid pd-grid--halves" data-testid="docs-index">
          {DOC_ORDER.map((d) => (
            <a
              key={d.slug}
              href={`/docs/${d.slug}`}
              className="pd-card pd-glass--interactive"
              style={{ ["--card-accent" as string]: "var(--cobalt)" }}
            >
              <span className="pd-card__edge" aria-hidden="true" />
              <div className="pd-row" style={{ justifyContent: "space-between", gap: 12 }}>
                <h3 style={{ fontSize: "1.08rem" }}>{d.title}</h3>
                <span aria-hidden="true" style={{ color: "var(--text-tertiary)" }}>
                  →
                </span>
              </div>
              <p className="pd-muted" style={{ fontSize: "0.93rem", lineHeight: 1.55, marginTop: 8 }}>
                {d.blurb}
              </p>
              <span className="pd-mono pd-dim" style={{ fontSize: "0.74rem", marginTop: 12 }}>
                {d.source}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export { EmptyState };