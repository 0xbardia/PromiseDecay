/**
 * Frontend unit tests.
 *
 * These cover the pure logic that carries product meaning: URL admissibility (mirrored
 * from the contract), drift diffing, and slug/label derivation.
 */
import { describe, expect, it } from "vitest";
import {
  BOUNDS,
  checkSourceUrl,
  isDelivery,
  isIntegrity,
  promiseRef,
  responseLabel,
  shortAddress,
  slugifyProject,
} from "@promisedecay/domain";

describe("checkSourceUrl", () => {
  it("accepts ordinary http and https URLs", () => {
    expect(checkSourceUrl("https://example.com/blog").ok).toBe(true);
    expect(checkSourceUrl("http://example.com").ok).toBe(true);
    expect(checkSourceUrl("https://example.com:8443/a?b=c#d").ok).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["ftp://example.com/x", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["data:text/html,<script>", "scheme"],
    ["https://user:pass@example.com", "credentials"],
    ["http://localhost/x", "localhost"],
    ["http://foo.localhost/x", "localhost"],
    ["http://127.0.0.1/x", "ip-literal"],
    ["http://10.0.0.5/x", "ip-literal"],
    ["http://192.168.1.1/x", "ip-literal"],
    ["http://169.254.169.254/latest", "ip-literal"],
    ["http://010.0.0.1/x", "ip-literal"],
    ["http://[::1]/x", "ip-literal"],
    // Non-canonical spellings that still resolve to loopback. Each of these was accepted
    // before the screen was inverted — see PD-SEC-017.
    ["http://2130706433/x", "ip-literal"],
    ["http://0x7f000001/x", "ip-literal"],
    ["http://0x7f.0.0.1/x", "ip-literal"],
    ["http://127.1/x", "ip-literal"],
    ["http://127.0.0.1/x", "ip-literal"],
    ["http://2130706433:8080/x", "ip-literal"],
    ["http://localhost./x", "localhost"],
    ["http://foo.localhost./x", "localhost"],
    ["http://LOCALHOST./x", "localhost"],
    ["https://example.com:22/", "unusual-port"],
    // 99999 is numeric, so it fails the range check rather than the format check.
    ["https://example.com:99999/", "port-range"],
    ["https://example.com:abc/", "invalid-port"],
    ["https://example.com:0/", "port-range"],
  ])("rejects %s", (url, reason) => {
    const result = checkSourceUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it("rejects a URL beyond the contract's length bound", () => {
    const long = `https://example.com/${"a".repeat(BOUNDS.MAX_URL)}`;
    const result = checkSourceUrl(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-long");
  });
});

describe("slugifyProject", () => {
  it("produces a stable url segment", () => {
    expect(slugifyProject("Acme Protocol")).toBe("acme-protocol");
    expect(slugifyProject("Northwind Labs")).toBe("northwind-labs");
    expect(slugifyProject("  Spaced  Out  ")).toBe("spaced-out");
  });

  it("never produces an empty slug", () => {
    expect(slugifyProject("!!!")).toBe("unknown");
    expect(slugifyProject("")).toBe("unknown");
  });

  it("is deterministic", () => {
    expect(slugifyProject("Acme Protocol")).toBe(slugifyProject("Acme Protocol"));
  });
});

describe("status helpers", () => {
  it("recognises every delivery and integrity value", () => {
    for (const v of ["KEPT", "KEPT_LATE", "PARTIAL", "NOT_KEPT", "UNRESOLVED"]) {
      expect(isDelivery(v)).toBe(true);
    }
    for (const v of ["UNCHANGED", "NARROWED", "REFRAMED", "REVERSED", "UNKNOWN"]) {
      expect(isIntegrity(v)).toBe(true);
    }
    expect(isDelivery("MOSTLY_KEPT")).toBe(false);
    expect(isIntegrity("SORT_OF")).toBe(false);
  });
});

describe("responseLabel", () => {
  it("never claims authority for an unverified response", () => {
    const label = responseLabel("0x1234567890abcdef", false);
    expect(label).toContain("Response from");
    expect(label).not.toContain("official");
    expect(label).not.toContain("Official");
  });

  it("says verified only when verification is true", () => {
    expect(responseLabel("0x1234567890abcdef", true)).toContain("Verified");
  });
});

describe("display helpers", () => {
  it("shortens an address without losing recognisability", () => {
    const short = shortAddress("0x1234567890abcdef1234567890abcdef12345678");
    expect(short.startsWith("0x1234")).toBe(true);
    expect(short.endsWith("5678")).toBe(true);
  });

  it("formats a promise reference", () => {
    expect(promiseRef(1)).toBe("pd-1");
    expect(promiseRef("42")).toBe("pd-42");
  });
});