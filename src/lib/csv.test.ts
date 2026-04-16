import { describe, expect, it } from "vitest";
import { escapeField, toCsvRow } from "./csv";

describe("escapeField", () => {
  it("leaves plain values unquoted", () => {
    expect(escapeField("hello")).toBe("hello");
  });
  it("returns empty string for null or undefined", () => {
    expect(escapeField(null)).toBe("");
    expect(escapeField(undefined)).toBe("");
  });
  it("quotes values with commas", () => {
    expect(escapeField("a,b")).toBe('"a,b"');
  });
  it("quotes values with newlines", () => {
    expect(escapeField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("quotes values with quotes and doubles internal quotes", () => {
    expect(escapeField('she said "hi"')).toBe('"she said ""hi"""');
  });
  it("converts booleans and numbers to strings", () => {
    expect(escapeField(true)).toBe("true");
    expect(escapeField(42)).toBe("42");
  });
});

describe("toCsvRow", () => {
  it("joins fields with commas and terminates with CRLF", () => {
    expect(toCsvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
  });
  it("escapes each field correctly", () => {
    expect(toCsvRow(["a,b", 'he said "hi"', null])).toBe('"a,b","he said ""hi""",\r\n');
  });
});
