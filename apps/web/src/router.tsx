/**
 * Client-side router.
 *
 * Hand-rolled and tiny on purpose (Principle VI): PromiseDecay has a fixed, known route
 * table and no nested/loader requirements, so a router dependency would add weight
 * without adding capability.
 *
 * Handles history, popstate, scroll restoration, and 404. Every route is a real module
 * with a designed page — there are no placeholder routes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const routes = [
  { path: "/", load: () => import("./pages/Landing").then((m) => m.Landing) },
  { path: "/explore", load: () => import("./pages/Explore").then((m) => m.Explore) },
  { path: "/how-it-works", load: () => import("./pages/HowItWorks").then((m) => m.HowItWorks) },
  { path: "/roadmap", load: () => import("./pages/Roadmap").then((m) => m.Roadmap) },
  { path: "/docs", load: () => import("./pages/Docs").then((m) => m.Docs) },
  // Docs articles. Without this entry every /docs/<slug> deep link fell through to the
  // 404 page, which is exactly the kind of defect a router table hides.
  { path: "/docs/:slug", load: () => import("./pages/Docs").then((m) => m.Docs) },
  { path: "/record", load: () => import("./pages/Record").then((m) => m.Record) },
  {
    path: "/promises/:id",
    load: () => import("./pages/PromiseDetail").then((m) => m.PromiseDetail),
  },
  {
    path: "/promises/:id/evidence",
    load: () => import("./pages/PromiseAction").then((m) => m.PromiseAction),
  },
  {
    path: "/promises/:id/update",
    load: () => import("./pages/PromiseAction").then((m) => m.PromiseAction),
  },
  {
    path: "/promises/:id/respond",
    load: () => import("./pages/PromiseAction").then((m) => m.PromiseAction),
  },
  {
    path: "/promises/:id/challenge",
    load: () => import("./pages/PromiseAction").then((m) => m.PromiseAction),
  },
  {
    path: "/projects/:slug",
    load: () => import("./pages/Project").then((m) => m.Project),
  },
] as const;

/**
 * Every route page receives the matched path parameters and the current pathname.
 * Typing the router this way means a page cannot silently ignore its route params.
 */
export interface RouteProps {
  params: Record<string, string>;
  pathname: string;
}

export interface Match {
  path: string;
  params: Record<string, string>;
  Component: React.ComponentType<RouteProps>;
}

/** Match a path against the route table, extracting `:param` segments. */
export function matchRoute(pathname: string): { path: string; params: Record<string, string> } | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const route of routes) {
    const rp = route.path.replace(/\/+$/, "") || "/";
    if (!rp.includes(":")) {
      if (rp === clean) return { path: route.path, params: {} };
      continue;
    }
    const rSeg = rp.split("/");
    const cSeg = clean.split("/");
    if (rSeg.length !== cSeg.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rSeg.length; i++) {
      const r = rSeg[i]!;
      const c = cSeg[i]!;
      if (r.startsWith(":")) params[r.slice(1)] = decodeURIComponent(c);
      else if (r !== c) {
        ok = false;
        break;
      }
    }
    if (ok) return { path: route.path, params };
  }
  return null;
}

export function useRouter() {
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname
  );

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (to === window.location.pathname) return;
    if (opts.replace) window.history.replaceState({}, "", to);
    else window.history.pushState({}, "", to);
    setPathname(to);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return { pathname, navigate };
}

export function useRoute(pathname: string) {
  const match = useMemo(() => matchRoute(pathname), [pathname]);
  const [Component, setComponent] = useState<React.ComponentType<RouteProps> | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!match) {
      setMissing(true);
      setComponent(null);
      return;
    }
    setMissing(false);
    void loadFor(match.path).then((mod) => {
      if (cancelled) return;
      setComponent(() => mod);
    });
    return () => {
      cancelled = true;
    };
  }, [match]);

  return { match, Component, missing };
}

const cache = new Map<string, React.ComponentType<RouteProps>>();

async function loadFor(path: string): Promise<React.ComponentType<RouteProps>> {
  const hit = cache.get(path);
  if (hit) return hit;
  const route = routes.find((r) => r.path === path);
  if (!route) throw new Error(`no route for ${path}`);
  const mod = await route.load();
  cache.set(path, mod);
  return mod;
}

/** Programmatic navigation for plain <a> interception. */
export function onLinkClick(e: React.MouseEvent, navigate: (to: string) => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const anchor = (e.target as HTMLElement).closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("/")) return;
  if (anchor.target === "_blank") return;
  e.preventDefault();
  navigate(href);
}

export { routes };