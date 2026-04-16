import { describe, expect, it, beforeAll } from "vitest";
import { signToken, verifyToken } from "./admin-auth";

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = "x".repeat(64);
});

describe("signToken / verifyToken", () => {
  it("round-trips a fresh token", () => {
    const token = signToken();
    expect(verifyToken(token)).toBe(true);
  });
  it("rejects a malformed token", () => {
    expect(verifyToken("nope")).toBe(false);
    expect(verifyToken("123.abc")).toBe(false);
    expect(verifyToken("")).toBe(false);
  });
  it("rejects a tampered token", () => {
    const token = signToken();
    const [ts, sig] = token.split(".");
    const tampered = `${Number(ts) + 1}.${sig}`;
    expect(verifyToken(tampered)).toBe(false);
  });
  it("rejects an expired token", () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const token = signToken(eightDaysAgo);
    expect(verifyToken(token)).toBe(false);
  });
});
