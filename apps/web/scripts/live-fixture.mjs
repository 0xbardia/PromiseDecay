/**
 * Live-certification fixture: a synthetic, clearly-labelled promise whose evidence pages are
 * served from this deployment's own public origin, so validator fetches are observable in the
 * web server's access log.
 *
 * The scenario is built to defeat the pre-1.0.1 decision-input bug on purpose. Four neutral
 * evidence items are stored FIRST, so the old "first three evidence URLs" rule would fetch only
 * those, and would never reach the original source, the relevant drift sources or the challenge.
 *
 *   old rule  (first 3 stored evidence URLs)   : ev-d, ev-c, ev-b
 *   new rule, request_resolution               : original, newest drift, older drift
 *   new rule, re_evaluate                      : original, challenge, newest drift
 *
 * Nothing here is a real organisation or a real release: every page says so.
 */
import fs from "node:fs";
import path from "node:path";
import { createAccount, createClient, chains } from "genlayer-js";

export const PUBLIC_ORIGIN = process.env.FIXTURE_ORIGIN ?? "https://promisedecay.bydx.fun";
export const RPC_URL = process.env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
const KEY_FILE = process.env.PD_DEPLOYER_KEY_FILE ?? "/root/.hermes/cache/scratch/pd_deployer_key.json";
const TERMINAL = new Set(["FINALIZED", "REVERTED", "UNDERCATED", "GENESIS"]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const iso = (ts) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
export const jsonSafe = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/** The key stays in this process. It is never printed and never given to a browser page. */
export function loadAccount() {
  const { privateKey } = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  return { account: createAccount(privateKey), privateKey };
}

/** Retry only on the Studio per-IP request cap, which is a shared, rolling budget. */
export async function withRateLimitRetry(label, fn, attempts = 12) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!/rate limit/i.test(msg) || i >= attempts) throw e;
      console.log(`      [${label}] rate limited, backing off 45s (attempt ${i})`);
      await sleep(45_000);
    }
  }
}

export async function rpc(method, params = []) {
  return withRateLimitRetry(method, async () => {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  });
}

export function sdk(address) {
  const { account } = loadAccount();
  const client = createClient({ chain: chains.studionet, endpoint: RPC_URL, account });
  const read = (functionName, args = []) =>
    withRateLimitRetry(functionName, () => client.readContract({ address, functionName, args }));

  /** Sign + broadcast through the SDK, then poll to a terminal state. Returns {hash,status}. */
  const write = async (label, functionName, args, pollMs = 6000) => {
    const hash = await withRateLimitRetry(label, () =>
      client.writeContract({ address, functionName, args, value: 0n })
    );
    const started = Date.now();
    let last = "";
    for (;;) {
      const st = await rpc("gen_getTransactionStatus", [hash]);
      if (st !== last) {
        last = st;
        console.log(`      ${label}: ${st} (+${Math.round((Date.now() - started) / 1000)}s)`);
      }
      if (TERMINAL.has(st)) return { hash, status: st };
      await sleep(pollMs);
    }
  };
  return { client, read, write, address: account.address };
}

// ---------------------------------------------------------------------------------------
// Fixture definition
// ---------------------------------------------------------------------------------------

export function fixture(runId, nowTs, deadlineTs) {
  const base = `${PUBLIC_ORIGIN}/fixtures/${runId}`;
  const releaseTs = deadlineTs - 7200;
  const banner = `SYNTHETIC CERTIFICATION FIXTURE for PromiseDecay run ${runId}. Meridian Labs is a fictional organisation and nothing on this page describes a real release.`;

  const pages = {
    "announcement.html": `Meridian Labs — Aurora SDK v2 announcement. Meridian Labs will make the Aurora SDK v2 publicly available to all developers, with no waitlist and no invitation, before ${iso(deadlineTs)}. ${banner}`,
    "partner-update.html": `Meridian Labs partner update. Aurora SDK v2 is currently available to selected design partners only. Broader availability is planned for a later date. ${banner}`,
    "invite-beta.html": `Meridian Labs beta notice. The Aurora SDK v2 beta is limited to invited partners. Access requests from other developers are not being accepted yet. ${banner}`,
    "offsite.html": `Meridian Labs shared photographs from its team offsite last month. ${banner}`,
    "release-notes.html": `Aurora SDK v2.0.0 — public release notes. Published ${iso(releaseTs)} (unix ${releaseTs}), before the stated deadline. Aurora SDK v2.0.0 is available to every developer through the public package registry, installable with "npm install aurora-sdk@2". There is no waitlist, no invitation and no partner agreement required. This release supersedes the earlier design-partner preview. ${banner}`,
    "ev-a.html": `Meridian Labs changelog: documentation typo fixes in the Aurora SDK v1 guides. ${banner}`,
    "ev-b.html": `Meridian Labs changelog: updated the contributor guide for Aurora SDK v1. ${banner}`,
    "ev-c.html": `Meridian Labs changelog: renamed an internal build script in Aurora SDK v1. ${banner}`,
    "ev-d.html": `Meridian Labs changelog: refreshed the Aurora SDK v1 logo assets. ${banner}`,
  };

  const url = (name) => `${base}/${name}`;
  return {
    runId,
    base,
    pages,
    url,
    releaseTs,
    promise: [
      `Meridian Labs (fixture ${runId})`,
      "Meridian Labs",
      "Meridian Labs will make the Aurora SDK v2 publicly available to all developers before the deadline.",
      "release",
      "Aurora SDK v2",
      "all developers",
      deadlineTs,
      "none",
      url("announcement.html"),
    ],
    // Inserted in this order on purpose: the old rule would fetch only the first three.
    evidence: ["d", "c", "b", "a"].map((k) => [url(`ev-${k}.html`), `Neutral changelog item ${k.toUpperCase()}.`, "SOURCE"]),
    drift: [
      ["Meridian Labs update: Aurora SDK v2 is currently available to selected design partners only.", url("partner-update.html")],
      ["Meridian Labs shared photographs from its team offsite.", url("offsite.html")],
      ["Meridian Labs beta notice: the Aurora SDK v2 beta is limited to invited partners.", url("invite-beta.html")],
    ],
    challenge: [
      "Aurora SDK v2.0.0 was published to the public package registry before the deadline and is installable by any developer without invitation, see the release notes.",
      url("release-notes.html"),
    ],
    expected: {
      old: ["ev-d", "ev-c", "ev-b"],
      initial: ["announcement", "invite-beta", "partner-update"],
      reeval: ["announcement", "release-notes", "invite-beta"],
    },
  };
}

/** Write the fixture pages into the directory the production web server already serves. */
export function writePages(fx, distDir) {
  const dir = path.join(distDir, "fixtures", fx.runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(fx.pages)) {
    fs.writeFileSync(
      path.join(dir, name),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name} — certification fixture</title></head><body><main><p>${text}</p></main></body></html>\n`
    );
  }
  return dir;
}

/** Fail loudly if the SPA's catch-all answered instead of the fixture page. */
export async function assertPagesServed(fx) {
  for (const [name, text] of Object.entries(fx.pages)) {
    const res = await fetch(fx.url(name));
    const body = await res.text();
    if (!res.ok || !body.includes(text.slice(0, 40)) || body.includes('id="root"')) {
      throw new Error(`fixture page not served correctly: ${fx.url(name)} (${res.status})`);
    }
  }
}

/** Public fetches of fixture pages, from the web server's own access log. */
export function fetchLog(runId, sinceMs) {
  const raw = fs.readFileSync("/var/log/nginx/access.log", "utf8").split("\n");
  const out = [];
  for (const line of raw) {
    const m = line.match(/^(\S+) \S+ \S+ \[([^\]]+)\] "GET (\/fixtures\/[^ ]+) [^"]*" (\d+) \d+ "[^"]*" "([^"]*)"/);
    if (!m || !m[3].includes(`/fixtures/${runId}/`)) continue;
    const [d, mon, y, hh, mm, ss] = m[2].replace(" +0000", "").split(/[/: ]/);
    const t = Date.parse(`${d} ${mon} ${y} ${hh}:${mm}:${ss} UTC`);
    if (t < sinceMs) continue;
    out.push({ t, ip: m[1], page: m[3].split("/").pop().replace(".html", ""), status: Number(m[4]), ua: m[5].slice(0, 60) });
  }
  return out;
}

export function summarizeFetches(rows, t0, t1) {
  const counts = {};
  for (const r of rows) if (r.t >= t0 && r.t <= t1 && r.status === 200) counts[r.page] = (counts[r.page] ?? 0) + 1;
  return counts;
}
