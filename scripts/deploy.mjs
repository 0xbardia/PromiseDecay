/**
 * PromiseDecay deployment + read certification tooling.
 *
 * Drives genlayer-js directly against a GenLayer network. Reads the deployer key from a
 * 600-mode file OUTSIDE the repository; the key is never written into the repo, never
 * logged, and never shipped to the browser.
 *
 * Usage:
 *   node scripts/deploy.mjs deploy [contractPath]
 *   node scripts/deploy.mjs certify [contractAddress]
 */
import fs from "node:fs";
import path from "node:path";
import { createAccount, createClient, chains } from "genlayer-js";

const KEY_FILE =
  process.env.PD_DEPLOYER_KEY_FILE || "/root/.hermes/cache/scratch/pd_deployer_key.json";

// ---------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...loadDotEnv(path.resolve(process.cwd(), ".env")), ...process.env };
const NETWORK_KEY = env.GENLAYER_NETWORK || "studionet";

const CHAIN_MAP = {
  studionet: chains.studionet,
  "testnet-bradbury": chains.testnetBradbury,
  "testnet-asimov": chains.testnetAsimov,
  localnet: chains.localnet,
};
const CHAIN = CHAIN_MAP[NETWORK_KEY];
if (!CHAIN) {
  console.error(`Unknown GENLAYER_NETWORK: ${NETWORK_KEY}`);
  console.error(`Supported: ${Object.keys(CHAIN_MAP).join(", ")}`);
  process.exit(1);
}
const RPC_URL = env.GENLAYER_RPC_URL || CHAIN.rpcUrls.default.http[0];
const EXPLORER_API =
  env.GENLAYER_EXPLORER_API || "https://explorer-studio.genlayer.com/api";

const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------------------
// Raw RPC helpers: status polling stays independent of genlayer-js internals.
// ---------------------------------------------------------------------------------------

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "genlayer-js/1.1.8" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const TERMINAL = new Set(["FINALIZED", "REVERTED", "UNDERCATED", "GENESIS"]);

async function waitFinal(txHash, timeoutMs = 20 * 60 * 1000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const st = await rpc("gen_getTransactionStatus", [txHash]);
    if (st !== last) {
      last = st;
      log(`   status: ${st}  (+${Math.round((Date.now() - started) / 1000)}s)`);
    }
    if (TERMINAL.has(st)) return st;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return "TIMEOUT";
}

/**
 * Resolve a finalized deployment's contract address.
 *
 * Studio nodes do not all expose gen_getTransactionReceipt, so the address is read from
 * the Studio explorer, which reports the deployment target in `to_address`. This is the
 * same field the chain reports; it is never guessed.
 */
async function deploymentAddress(txHash) {
  try {
    const r = await rpc("gen_getTransactionReceipt", [txHash]);
    if (r?.contractAddress ?? r?.contract_address) {
      return { address: r.contractAddress ?? r.contract_address, source: "gen_getTransactionReceipt" };
    }
  } catch {
    // Fall through to the explorer.
  }

  const url = `${EXPLORER_API}/transactions/${txHash}`;
  const res = await fetch(url, { headers: { "User-Agent": "promisedecay-deploy/1.0" } });
  if (!res.ok) throw new Error(`explorer returned HTTP ${res.status} for ${txHash}`);
  const body = await res.json();
  const tx = body?.transaction ?? body;
  const address = tx?.to_address;
  if (!address) throw new Error("explorer response contained no contract address");
  return { address, source: "studio explorer" };
}

// ---------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------

function makeClients(withSigner) {
  let account = null;
  if (withSigner) {
    const { privateKey } = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    account = createAccount(privateKey);
  }
  // createClient builds its own transport from the chain config; `endpoint` overrides
  // the RPC URL, and `account` is what signs writes.
  const glClient = createClient({
    chain: CHAIN,
    endpoint: RPC_URL,
    ...(account ? { account } : {}),
  });
  return { glClient, address: account?.address ?? null };
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

async function cmdDeploy() {
  const contractFile = process.argv[3] || "contracts/PromiseDecay.py";
  const code = fs.readFileSync(path.resolve(process.cwd(), contractFile), "utf8");
  const { glClient, address } = makeClients(true);

  log(`network : ${NETWORK_KEY} (chain ${CHAIN.id})`);
  log(`rpc     : ${RPC_URL}`);
  log(`deployer: ${address}`);
  log(`contract: ${contractFile} (${code.length} bytes)`);

  // deployContract resolves to the GenLayer transaction hash as a plain string.
  const res = await glClient.deployContract({ code });
  const txHash = typeof res === "string" ? res : res.transactionHash ?? res.hash;
  log(`deployment tx: ${txHash}`);

  const status = await waitFinal(txHash);
  log(`final status : ${status}`);
  if (status !== "FINALIZED") {
    throw new Error(`deployment did not finalize (status=${status})`);
  }

  const { address: contractAddress, source } = await deploymentAddress(txHash);

  // Never report an address we have not confirmed is live on chain.
  const schema = await glClient.getContractSchema(contractAddress);
  const methodCount = Object.keys(schema?.methods ?? {}).length;
  if (methodCount === 0) {
    throw new Error(`address ${contractAddress} reports no methods; refusing to report it`);
  }
  log(`address source : ${source}`);
  log(`schema methods : ${methodCount}`);
  log(`CONTRACT_ADDRESS=${contractAddress}`);
  return contractAddress;
}

async function readRaw(glClient, address, method, args = []) {
  const schema = await glClient.getContractSchema(address);
  const contract = glClient.createContract({ address, abi: schema.abi });
  const fn = contract.methods[method];
  if (!fn) throw new Error(`method ${method} not present in schema`);
  return await fn(...args);
}

async function cmdCertify(target) {
  const address = target || env.GENLAYER_CONTRACT_ADDRESS;
  if (!address) throw new Error("no contract address given and GENLAYER_CONTRACT_ADDRESS unset");

  const { glClient } = makeClients(false);
  log(`certifying reads on ${address} @ ${NETWORK_KEY}\n`);

  const ids = (await readRaw(glClient, address, "get_all_promise_ids")) ?? [];
  const first = ids.length ? ids[0] : null;

  const isJson = (v) => {
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  };

  const cases = [
    { method: "get_version", args: [], check: (v) => v === "1.0.0", expected: '"1.0.0"' },
    { method: "get_promise_count", args: [], check: (v) => Number(v) >= 0, expected: "integer >= 0" },
    { method: "get_config", args: [], check: (v) => !!v && typeof v === "object" && !!v.contract_version, expected: "object" },
    { method: "get_all_promise_ids", args: [], check: (v) => Array.isArray(v), expected: "array" },
  ];

  if (first !== null) {
    cases.push(
      { method: "get_promise", args: [first], check: (v) => !!v && !!v.original_quote, expected: "object w/ original_quote" },
      { method: "get_evidence_count", args: [first], check: (v) => Number(v) >= 0, expected: "integer >= 0" },
      { method: "get_evidence", args: [first], check: isJson, expected: "JSON string" },
      { method: "get_drift_count", args: [first], check: (v) => Number(v) >= 0, expected: "integer >= 0" },
      { method: "get_drift", args: [first], check: isJson, expected: "JSON string" },
      { method: "get_response_count", args: [first], check: (v) => Number(v) >= 0, expected: "integer >= 0" },
      { method: "get_responses", args: [first], check: isJson, expected: "JSON string" },
      { method: "get_lifecycle_status", args: [first], check: (v) => typeof v === "string" && v.length > 0, expected: "lifecycle enum" },
      { method: "get_created_at", args: [first], check: (v) => Number(v) > 0, expected: "unix seconds > 0" },
      { method: "get_deadline_at", args: [first], check: (v) => Number(v) > 0, expected: "unix seconds > 0" },
      { method: "get_challenge_window", args: [first], check: (v) => !!v && typeof v === "object", expected: "object" },
      { method: "get_challenge_count", args: [first], check: (v) => Number(v) >= 0, expected: "integer >= 0" },
      { method: "get_challenges", args: [first], check: isJson, expected: "JSON string" },
    );
    log(`promise ids present: ${ids.length}; per-promise reads use id ${first}\n`);
  } else {
    log("no promises on chain yet - per-promise reads skipped\n");
  }

  const rows = [];
  for (const c of cases) {
    let actual;
    let ok = false;
    try {
      actual = await readRaw(glClient, address, c.method, c.args);
      ok = c.check(actual);
    } catch (e) {
      actual = `ERROR: ${String(e.message).slice(0, 140)}`;
    }
    rows.push({
      method: c.method,
      input: c.args.map(String).join(", ") || "-",
      expected: c.expected,
      actual: String(actual).replace(/\s+/g, " ").slice(0, 80),
      status: ok ? "PASS" : "FAIL",
    });
  }

  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  log(pad("Method", 24) + pad("Input", 5) + pad("Expected", 24) + pad("Actual", 40) + "Result");
  log("-".repeat(95));
  for (const r of rows) {
    log(pad(r.method, 24) + pad(r.input, 5) + pad(r.expected, 24) + pad(r.actual, 40) + r.status);
  }
  const failed = rows.filter((r) => r.status === "FAIL");
  log(`\n${rows.length - failed.length}/${rows.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "deploy") await cmdDeploy();
  else if (cmd === "certify") await cmdCertify(rest[0]);
  else {
    console.error("usage: node scripts/deploy.mjs deploy | certify [address]");
    process.exit(2);
  }
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}