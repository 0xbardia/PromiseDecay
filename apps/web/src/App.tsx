/**
 * Application shell: navigation, routing, footer, and the 404 page.
 *
 * Every route resolves to a designed page — there are no placeholder routes, and an
 * unknown path gets a real 404 with a way forward rather than a blank screen.
 */
import { useEffect, useState } from "react";
import { GlassNavigation, EmptyState } from "./components/primitives";
import { onLinkClick, useRoute, useRouter } from "./router";
import { WalletButton } from "./components/WalletButton";

export function App() {
  const { pathname, navigate } = useRouter();
  const { match, Component } = useRoute(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const params = match?.params ?? {};

  // Close the mobile menu on navigation.
  useEffect(() => setMenuOpen(false), [pathname]);

  // Set a meaningful document title per route.
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "PromiseDecay — a public memory layer for promises",
      "/explore": "Explore promises — PromiseDecay",
      "/record": "Record a promise — PromiseDecay",
      "/how-it-works": "How it works — PromiseDecay",
      "/roadmap": "Roadmap — PromiseDecay",
      "/docs": "Documentation — PromiseDecay",
    };
    document.title =
      titles[pathname] ??
      (pathname.startsWith("/promises/")
        ? `Promise record — PromiseDecay`
        : "PromiseDecay");
  }, [pathname]);

  // The burger lives inside GlassNavigation; wire it after mount.
  useEffect(() => {
    const burger = document.querySelector<HTMLButtonElement>("[data-testid='nav-burger']");
    const links = document.querySelector<HTMLElement>(".pd-nav__links");
    if (!burger || !links) return;

    const onClick = () => {
      const open = links.classList.toggle("pd-nav__links--open");
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      setMenuOpen(open);
    };
    burger.addEventListener("click", onClick);
    return () => burger.removeEventListener("click", onClick);
  }, []);

  return (
    <div onClick={(e) => onLinkClick(e, navigate)}>
      <a className="pd-skip-link" href="#main">
        Skip to content
      </a>

      <GlassNavigation pathname={pathname} walletSlot={<WalletButton />} />

      <main id="main">
        {Component ? <Component params={params} pathname={pathname} /> : null}
        {!match ? <NotFound pathname={pathname} /> : null}
      </main>

      <footer className="pd-footer">
        <div className="pd-shell pd-shell--wide">
          <div
            className="pd-row pd-wrap"
            style={{ gap: 24, justifyContent: "space-between", alignItems: "flex-start" }}
          >
            <div style={{ maxWidth: "34ch" }}>
              <p style={{ fontWeight: 660, letterSpacing: "-0.02em" }}>PromiseDecay</p>
              <p className="pd-muted" style={{ fontSize: "0.88rem", marginTop: 7, lineHeight: 1.55 }}>
                A public memory layer for promises. Said. Tracked. Resolved.
              </p>
            </div>

            <nav aria-label="Footer" className="pd-row pd-wrap" style={{ gap: "10px 26px" }}>
              <a className="pd-nav__link" href="/explore">Explore</a>
              <a className="pd-nav__link" href="/record">Record</a>
              <a className="pd-nav__link" href="/how-it-works">How it works</a>
              <a className="pd-nav__link" href="/docs">Docs</a>
              <a className="pd-nav__link" href="/roadmap">Roadmap</a>
              <a
                className="pd-nav__link"
                href="https://github.com/0xbardia/PromiseDecay"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </nav>
          </div>

          <hr className="pd-rule" style={{ margin: "26px 0 18px" }} />

          <p className="pd-hint">
            Built on GenLayer. Contract{" "}
            <span className="pd-mono">
              {import.meta.env.VITE_GENLAYER_CONTRACT_ADDRESS ?? "not configured"}
            </span>{" "}
            on {import.meta.env.VITE_GENLAYER_NETWORK ?? "studionet"}.
          </p>
        </div>
      </footer>
    </div>
  );
}

function NotFound({ pathname }: { pathname: string }) {
  return (
    <section className="pd-section">
      <div className="pd-shell">
        <EmptyState
          title="This page does not exist"
          body={`Nothing is published at ${pathname}. It may have moved, or it may never have existed.`}
          icon="◌"
          action={
            <div className="pd-row pd-wrap" style={{ gap: 10, justifyContent: "center" }}>
              <a className="pd-btn pd-btn--primary" href="/">
                Go home
              </a>
              <a className="pd-btn pd-btn--secondary" href="/explore">
                Explore promises
              </a>
            </div>
          }
        />
      </div>
    </section>
  );
}

export { NotFound };