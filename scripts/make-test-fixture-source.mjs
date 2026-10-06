/**
 * Derive the TEST-ONLY short-window contract source from the production contract.
 *
 * The production contract is never edited for testing. A same-session certification of
 * `finalize` needs a challenge window shorter than seven days, and the smallest honest way to
 * get one is to derive a throwaway copy that differs from production in exactly two lines:
 *
 *   CHALLENGE_WINDOW_SECONDS   7 days  ->  <seconds>
 *   CONTRACT_VERSION           "x.y.z" ->  "x.y.z-TEST-SHORT-WINDOW"
 *
 * Every other byte is identical, which this script asserts before writing anything. The output
 * is meant for a scratch directory and a throwaway deployment, never for the repository or the
 * production address.
 *
 *   node scripts/make-test-fixture-source.mjs <outFile> [windowSeconds=600]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../contracts/PromiseDecay.py");
const WINDOW_LINE = "CHALLENGE_WINDOW_SECONDS = 7 * 24 * 60 * 60  # 7 days";
const VERSION_RE = /^CONTRACT_VERSION = "(\d+\.\d+\.\d+)"$/m;
const MAX_FIXTURE_WINDOW = 3600;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function deriveFixture(source, windowSeconds) {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 60 || windowSeconds > MAX_FIXTURE_WINDOW) {
    throw new Error(`windowSeconds must be an integer in [60, ${MAX_FIXTURE_WINDOW}]`);
  }
  if (source.split(WINDOW_LINE).length !== 2) {
    throw new Error("production window line not found exactly once; refusing to derive a fixture");
  }
  const version = VERSION_RE.exec(source);
  if (!version) throw new Error("CONTRACT_VERSION line not found; refusing to derive a fixture");

  const fixture = source
    .replace(
      WINDOW_LINE,
      `CHALLENGE_WINDOW_SECONDS = ${windowSeconds}  # TEST-ONLY short window; production is 7 days`
    )
    .replace(VERSION_RE, `CONTRACT_VERSION = "${version[1]}-TEST-SHORT-WINDOW"`);

  const a = source.split("\n");
  const b = fixture.split("\n");
  const changed = a.filter((line, i) => line !== b[i]).length;
  if (a.length !== b.length || changed !== 2) {
    throw new Error(`fixture differs from production in ${changed} lines, expected exactly 2`);
  }
  return fixture;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, seconds] = process.argv.slice(2);
  if (!out) {
    console.error("usage: node scripts/make-test-fixture-source.mjs <outFile> [windowSeconds=600]");
    process.exit(2);
  }
  const windowSeconds = seconds === undefined ? 600 : Number(seconds);
  const source = readFileSync(SOURCE, "utf8");
  const fixture = deriveFixture(source, windowSeconds);
  writeFileSync(resolve(out), fixture);
  console.log(`production source sha256 : ${sha256(source)}`);
  console.log(`fixture source sha256    : ${sha256(fixture)}`);
  console.log(`challenge window         : ${windowSeconds}s (production 604800s)`);
  console.log(`wrote ${resolve(out)}`);
}
