import { describe, it, expect } from "vitest";
import { maskContact, normalizeCode, csvEscape, toCsv } from "../src/http";

describe("maskContact", () => {
  it("邮箱脱敏", () => {
    expect(maskContact("test@example.com")).toBe("te***@example.com");
    expect(maskContact("ab@test.com")).toBe("ab***@test.com");
  });

  it("手机号/其他脱敏", () => {
    expect(maskContact("13800138000")).toBe("13***00");
    expect(maskContact("abcdef")).toBe("ab***ef");
  });

  it("短字符串", () => {
    expect(maskContact("ab")).toBe("***");
    expect(maskContact("abcd")).toBe("***");
  });

  it("空白处理", () => {
    expect(maskContact("  ")).toBe("***");
    expect(maskContact("")).toBe("***");
  });
});

describe("normalizeCode", () => {
  it("trim + lowercase", () => {
    expect(normalizeCode("  HELLO  ")).toBe("hello");
    expect(normalizeCode("ABC123")).toBe("abc123");
  });

  it("空值处理", () => {
    expect(normalizeCode()).toBe("");
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode(undefined)).toBe("");
  });
});

describe("csvEscape", () => {
  it("正常值不变", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(123)).toBe("123");
  });

  it("公式注入防护", () => {
    expect(csvEscape("=SUM(A1)")).toBe("\t=SUM(A1)");
    expect(csvEscape("+cmd")).toBe("\t+cmd");
    expect(csvEscape("-test")).toBe("\t-test");
    expect(csvEscape("@user")).toBe("\t@user");
  });

  it("空值处理", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("基本导出", () => {
    const rows = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const csv = toCsv(rows, ["name", "age"]);
    expect(csv).toBe("name,age\nAlice,30\nBob,25");
  });

  it("含逗号的值加引号", () => {
    const rows = [{ name: "Smith, John", age: 40 }];
    const csv = toCsv(rows, ["name", "age"]);
    expect(csv).toBe('name,age\n"Smith, John",40');
  });
});
