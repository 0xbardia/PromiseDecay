/**
 * Seed the deployed contract with real public commitments and real evidence.
 *
 * Why this exists
 * ---------------
 * Every promise on the deployed contract resolved UNRESOLVED / UNKNOWN. That was the contract
 * behaving correctly — the seeded evidence URLs were placeholders that genuinely did not support
 * the claims, and refusing to invent a verdict is the single most important property the
 * product has. But as a demonstration it means the headline feature, "GenLayer consensus
 * determines what was actually delivered", showed nothing but a shrug, and every reader had no
 * way to tell a working feature from a broken one.
 *
 * These records use real commitments whose outcomes are documented on pages that are actually
 * fetchable, so consensus has something true to work with. Nothing here asserts an outcome the
 * evidence does not support — whatever the validators decide is what gets reported.
 *
 * Not part of the contract test suite: it mutates chain state and costs real transactions.
 *
 *   PD_DEPLOYER_KEY_FILE=/path/to/key.json node scripts/seed-real.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createAccount, createClient, chains } from "genlayer-js";

const KEY_FILE = process.env.PD_DEPLOYER_KEY_FILE;
if (!KEY_FILE) {
  console.error("PD_DEPLOYER_KEY_FILE is not set. Point it at the key file outside the repository.");
  process.exit(2);
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = val;
  }
  return out;
}

const env = { ...loadDotEnv(path.resolve(process.cwd(), "../../.env")), ...process.env };
const NETWORK_KEY = env.GENLAYER_NETWORK || "studionet";
const CHAIN = chains[NETWORK_KEY];
const ADDRESS = env.GENLAYER_CONTRACT_ADDRESS;
const RPC_URL = env.GENLAYER_RPC_URL;
const account = createAccount(JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).privateKey);

const glClient = createClient({ chain: CHAIN, endpoint: RPC_URL, account });
const TERMINAL = new Set(["FINALIZED", "REVERTED", "UNDERCATED"]);

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function read(functionName, args = []) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await glClient.readContract({ address: ADDRESS, functionName, args });
    } catch (err) {
      const text = String(err?.message ?? err);
      const retryAfter = Number(err?.cause?.data?.retry_after_seconds ?? 0);
      if ((/rate limit/i.test(text) || /execution failed/i.test(text)) && attempt < 10) {
        const wait = Math.max(retryAfter, 6) * 1000;
        process.stdout.write(`      rate limited; waiting ${wait / 1000}s\n`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

async function waitFinal(hash, timeoutMs = 25 * 60 * 1000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    let st;
    try {
      st = await rpc("gen_getTransactionStatus", [hash]);
    } catch {
      st = null;
    }
    if (st && st !== last) {
      last = st;
      process.stdout.write(`      ${st} (+${Math.round((Date.now() - started) / 1000)}s)\n`);
    }
    if (st && TERMINAL.has(st)) return st;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return "TIMEOUT";
}

async function write(label, functionName, args) {
  process.stdout.write(`  ${label}\n`);
  let hash;
  for (let attempt = 1; ; attempt++) {
    try {
      hash = await glClient.writeContract({ address: ADDRESS, functionName, args });
      break;
    } catch (err) {
      const text = String(err?.message ?? err);
      const retryAfter = Number(err?.cause?.data?.retry_after_seconds ?? 0);
      if (/rate limit/i.test(text) && attempt < 10) {
        const wait = Math.max(retryAfter, 6) * 1000;
        process.stdout.write(`      rate limited; waiting ${wait / 1000}s\n`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  const status = await waitFinal(hash);
  process.stdout.write(`      -> ${status}  ${hash}\n`);
  return { hash, status };
}

const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Real commitments with publicly documented outcomes.
 *
 * `expect` is what the evidence points at, not an assertion: the validators decide, and the
 * reported verdict is whatever they actually reach.
 */
const RECORDS = [
  {
    key: "ethereum-merge",
    expect: "KEPT — the Merge completed before the stated deadline",
    spec: {
      project: "Ethereum",
      actor: "Ethereum Foundation",
      quote:
        "The Ethereum network will complete its transition to proof-of-stake consensus before the end of 2022.",
      action: "complete the transition to",
      object: "proof-of-stake consensus on the Ethereum mainnet",
      scope: "public",
      deadline: unix("2023-01-01T00:00:00Z"),
      conditions: "none stated",
      url: "https://ethereum.org/en/roadmap/merge/",
    },
    evidence: [
      {
        url: "https://ethereum.org/en/roadmap/merge/",
        kind: "SOURCE",
        quote:
          "The Merge was executed on September 15, 2022. This completed Ethereum's transition to proof-of-stake consensus.",
      },
    ],
  },
  {
    key: "meta-horizon-creator-events",
    expect: "NOT_KEPT / REVERSED — a promised creator capability was withdrawn",
    spec: {
      project: "Meta Horizon Worlds",
      actor: "Meta",
      quote:
        "Meta will expand creator tooling in Horizon Worlds through 2023 and beyond, including community-run creator events.",
      action: "expand creator tooling in",
      object: "Horizon Worlds",
      scope: "public",
      deadline: unix("2024-01-01T00:00:00Z"),
      conditions: "none stated",
      url: "https://www.theverge.com/2023/5/9/23717618/meta-metaverse-creators-horizon-worlds-events",
    },
    evidence: [
      {
        url: "https://www.theverge.com/2023/5/9/23717618/meta-metaverse-creators-horizon-worlds-events",
        kind: "RESPONSE",
        quote:
          "Meta announced it will no longer let creators using Horizon Worlds make dedicated events; as of May 9th, you will no longer see the option to create events.",
      },
    ],
  },
];

console.log("=".repeat(72));
console.log("PromiseDecay — seeding real public commitments with real evidence");
console.log("=".repeat(72));
console.log("network :", NETWORK_KEY, `(chain ${CHAIN.id})`);
console.log("contract:", ADDRESS);
console.log("signer  :", account.address);

for (const rec of RECORDS) {
  console.log(`\n--- ${rec.key} ---`);
  console.log(`    expected outcome: ${rec.expect}`);

  const before = (await read("get_all_promise_ids")).map(Number);
  const res = await write(`create promise (${rec.key})`, "create_promise", [
    rec.spec.project,
    rec.spec.actor,
    rec.spec.quote,
    rec.spec.action,
    rec.spec.object,
    rec.spec.scope,
    rec.spec.deadline,
    rec.spec.conditions,
    rec.spec.url,
  ]);
  if (res.status !== "FINALIZED") {
    console.log(`    create did not finalize (${res.status}); skipping`);
    continue;
  }

  const after = (await read("get_all_promise_ids")).map(Number);
  const id = after.find((x) => !before.includes(x));
  if (id === undefined) {
    console.log("    no new promise id appeared; skipping");
    continue;
  }
  console.log(`    promise_id = ${id}`);

  for (const ev of rec.evidence) {
    await write("add evidence", "add_evidence", [id, ev.kind, ev.url, ev.quote, "0x0000000000000000000000000000000000000000"]);
  }

  // Resolution requires the deadline to have passed.
  const now = Math.floor(Date.now() / 1000);
  if (rec.spec.deadline > now) {
    const waitS = rec.spec.deadline - now;
    process.stdout.write(`    waiting ${waitS}s for the deadline to pass\n`);
    await new Promise((r) => setTimeout(r, waitS * 1000));
  }

  const req = await write("request consensus resolution", "request_resolution", [id]);
  if (req.status !== "FINALIZED") {
    console.log(`    resolution did not finalize (${req.status})`);
    continue;
  }

  const result = await read("get_provisional_result", [id]);
  console.log(`    >> delivery : ${result?.delivery}`);
  console.log(`    >> integrity: ${result?.integrity}`);
  if (result?.explanation) {
    console.log(`    >> why      : ${String(result.explanation).slice(0, 320)}`);
  }
}

console.log("\n" + "=".repeat(72));
console.log("Seeding finished. Verdicts above are what consensus actually returned.");
console.log("=".repeat(72));