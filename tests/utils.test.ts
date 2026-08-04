import { describe, expect, it } from "vitest";
import { clampInteger, isValidEmail } from "../src/utils.js";

describe("clampInteger", () => {
  it("clamps and truncates", () => {
    expect(clampInteger(5, 0, 1, 10)).toBe(5);
    expect(clampInteger(0, 3, 1, 10)).toBe(1);
    expect(clampInteger(99, 3, 1, 10)).toBe(10);
    expect(clampInteger(3.9, 0, 1, 10)).toBe(3);
  });

  it("falls back on non-finite", () => {
    expect(clampInteger("x", 7, 1, 10)).toBe(7);
    expect(clampInteger(NaN, 7, 1, 10)).toBe(7);
    expect(clampInteger(undefined, 7, 1, 10)).toBe(7);
  });
});

describe("isValidEmail", () => {
  it("accepts simple valid emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  user@example.com ")).toBe(true);
  });

  it("rejects empty and malformed", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-at")).toBe(false);
    expect(isValidEmail("@x.com")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a@b.c d")).toBe(false);
  });
});
