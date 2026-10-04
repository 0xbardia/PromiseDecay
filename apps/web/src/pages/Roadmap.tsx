/**
 * /roadmap — a public roadmap that is honest about what exists.
 *
 * Only V1 is marked shipped, and only because it is verified on chain. Everything else
 * is labelled as planned, with no implied delivery dates.
 */
import { GlassSurface } from "../components/primitives";

interface RoadmapEntry {
  version: string;
  title: string;
  state: "shipped" | "planned";
  blurb: string;
  items: string[];
  color: string;
}

const ROADMAP: RoadmapEntry[] = [
  {
    version: "V1",
    title: "Public Promise Memory",
    state: "shipped",
    color: "var(--lime)",
    blurb: "The complete promise lifecycle, verified on GenLayer Studionet.",
    items: [
      "Immutable promise records",
      "Promise Drift with a chronological lineage",
      "Evidence with deduplication",
      "Public responses",
      "Semantic GenLayer resolution across two axes",
      "A bounded challenge window with real re-evaluation",
      "Project commitment history",
      "Search, filtering and cursor-paginated explore",
      "Wallet-signed writes",
      "Public documentation",
    ],
  },
  {
    version: "V1.1",
    title: "Identity and follow-up",
    state: "planned",
    color: "var(--sky)",
    blurb: "Proving that a response really came from the project.",
    items: [
      "Stronger project identity verification, so an official response can be labelled as one",
      "Watchlists to follow a project or promise",
      "Richer evidence provenance",
      "Share cards",
    ],
  },
  {
    version: "V1.2",
    title: "Keeping watch",
    state: "planned",
    color: "var(--amber)",
    blurb: "Notices when a promise moves.",
    items: [
      "Notifications when drift is attached or a deadline approaches",
      "Better organisation histories",
      "Source monitoring, so a changed source page is noticed",
    ],
  },
  {
    version: "V2",
    title: "Promise Graph",
    state: "planned",
    color: "var(--cobalt)",
    blurb: "Commitments as a composable structure.",
    items: [
      "Promise Graph across projects",
      "Composable commitment history",
      "Downstream reputation primitives",
    ],
  },
];

export function Roadmap() {
  return (
    <section className="pd-section" style={{ paddingBlock: "clamp(32px, 5vw, 60px)" }}>
      <div className="pd-shell pd-shell--wide">
        <header style={{ maxWidth: "66ch", marginBottom: 34 }}>
          <p className="pd-eyebrow">Roadmap</p>
          <h1 style={{ fontSize: "clamp(2.1rem, 4.4vw, 3.2rem)", margin: "10px 0 14px" }}>
            What is built, and what is not
          </h1>
          <p className="pd-muted" style={{ fontSize: "1.04rem", lineHeight: 1.62 }}>
            V1 is marked shipped because it is deployed and verified on chain — not because the
            code was written. Everything below it is planned, and planned is not the same as
            committed.
          </p>
        </header>

        <div className="pd-stack" style={{ gap: 18 }} data-testid="roadmap-list">
          {ROADMAP.map((entry) => (
            <GlassSurface
              key={entry.version}
              tone={entry.state === "shipped" ? "heavy" : "default"}
              className="pd-glass__pad"
              style={
                entry.state === "shipped"
                  ? { borderColor: "color-mix(in srgb, var(--lime) 34%, var(--glass-edge))" }
                  : undefined
              }
            >
              <div className="pd-row pd-wrap" style={{ gap: 14, justifyContent: "space-between" }}>
                <div>
                  <div className="pd-row" style={{ gap: 12 }}>
                    <span
                      className="pd-mono"
                      style={{ fontSize: "1.05rem", fontWeight: 700, color: entry.color }}
                    >
                      {entry.version}
                    </span>
                    <h2 style={{ fontSize: "clamp(1.2rem, 2.2vw, 1.55rem)" }}>{entry.title}</h2>
                  </div>
                  <p className="pd-muted" style={{ fontSize: "0.95rem", marginTop: 10, lineHeight: 1.58 }}>
                    {entry.blurb}
                  </p>
                </div>
                <span
                  className="pd-chip pd-chip--lg"
                  style={{ ["--chip-color" as string]: entry.color }}
                  data-testid={`roadmap-state-${entry.version}`}
                >
                  <span className="pd-chip__dot" aria-hidden="true" />
                  {entry.state === "shipped" ? "Shipped" : "Planned"}
                </span>
              </div>

              <ul
                className="pd-grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
                  gap: "8px 20px",
                  listStyle: "none",
                  padding: 0,
                  margin: "20px 0 0",
                }}
              >
                {entry.items.map((item) => (
                  <li key={item} className="pd-row" style={{ gap: 9, alignItems: "flex-start" }}>
                    <span
                      aria-hidden="true"
                      style={{ color: entry.color, fontSize: 13, lineHeight: 1.55, flexShrink: 0 }}
                    >
                      ▸
                    </span>
                    <span className="pd-muted" style={{ fontSize: "0.92rem", lineHeight: 1.55 }}>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassSurface>
          ))}
        </div>

        <div className="pd-cta-panel" style={{ marginTop: 32 }}>
          <p className="pd-eyebrow">Build in public</p>
          <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2.1rem)", maxWidth: "20ch" }}>
            The roadmap is not a promise. The record is.
          </h2>
          <p className="pd-muted" style={{ maxWidth: "54ch", lineHeight: 1.62 }}>
            Everything above is described honestly, including what has not been built. If a
            promise in this project was ever softened, you would be able to see it here too.
          </p>
          <div className="pd-row pd-wrap" style={{ gap: 12, justifyContent: "center" }}>
            <a
              className="pd-btn pd-btn--primary"
              href="https://github.com/0xbardia/PromiseDecay"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub repository
            </a>
            <a className="pd-btn pd-btn--secondary" href="/docs/roadmap">
              Docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export { ROADMAP };