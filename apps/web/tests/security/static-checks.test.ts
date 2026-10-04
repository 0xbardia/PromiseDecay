/**
 * Static security checks.
 *
 * These assert properties that are easy to break silently and expensive to discover late:
 * no unsafe HTML injection, no bundled signing key, no committed secrets.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_SRC = join(process.cwd(), "src");
const REPO_ROOT = process.cwd();

/**
 * Reduce a source file to its executable code.
 *
 * Comments and string/template literals are removed so that *mentioning* a dangerous API
 * in documentation does not read as *using* it. What remains is what actually runs.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // String and template literals. Good enough for this purpose and deliberately simple.
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|mjs|cjs|html)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("web source safety", () => {
  const files = walk(WEB_SRC);
  // Scan executable code only; see codeOnly() for why.
  const sources = files.map((f) => ({ file: f, text: codeOnly(readFileSync(f, "utf8")) }));

  it("finds the source tree", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("never uses dangerouslySetInnerHTML", () => {
    const offenders = sources.filter((s) => s.text.includes("dangerouslySetInnerHTML"));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("never assigns innerHTML directly", () => {
    const offenders = sources.filter((s) => /\binnerHTML\b\s*=/.test(s.text));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("never calls eval or the Function constructor", () => {
    const offenders = sources.filter(
      (s) => /\beval\s*\(/.test(s.text) || /new\s+Function\s*\(/.test(s.text)
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("never calls document.write", () => {
    const offenders = sources.filter((s) => s.text.includes("document.write"));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("contains no private key material", () => {
    // Scan the RAW file here: a key inside a string literal is still a key. A 0x-prefixed
    // 32-byte value is a private key; public addresses are 20 bytes and tx hashes are
    // documented test fixtures rather than credentials.
    const raw = files.map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
    const offenders = raw.filter((s) => /\b(?:PRIVATE_KEY|privateKey)\s*[:=]\s*["'`]0x[0-9a-fA-F]{64}/.test(s.text));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("does not sign on the server side", () => {
    // The web app must delegate signing to the user's wallet.
    const offenders = sources.filter((s) => /privateKeyToAccount/.test(s.text));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

describe("repository hygiene", () => {
  it("does not commit a .env file", () => {
    const gitignore = readFileSync(join(REPO_ROOT, "../../.gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env$/m);
  });

  it("ignores node_modules and build output", () => {
    const gitignore = readFileSync(join(REPO_ROOT, "../../.gitignore"), "utf8");
    expect(gitignore).toMatch(/node_modules/);
    expect(gitignore).toMatch(/dist/);
  });

  it("declares a restrictive CSP in the production server", () => {
    const server = readFileSync(join(WEB_SRC, "../server/index.mjs"), "utf8");
    expect(server).toContain("Content-Security-Policy");
    // script-src must not permit unsafe-inline or unsafe-eval.
    const scriptSrc = server.match(/script-src ([^"']+)/)?.[1] ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(server).toContain("frame-ancestors 'none'");
  });
});