import { describe, it, expect } from "vitest";
import { createSystemConfigRegistry } from "../src/config.js";

const TEST_DEFS = [
  { key: "site_name", label: "站点名称", description: "", effect: "", scope: "admin" as const, type: "string" as const, defaultValue: "" },
  { key: "site_enabled", label: "启用", description: "", effect: "", scope: "admin" as const, type: "boolean" as const, defaultValue: "true" },
  { key: "max_items", label: "最大数量", description: "", effect: "", scope: "admin" as const, type: "integer" as const, defaultValue: "10", min: 1, max: 100 },
  { key: "public_title", label: "公开标题", description: "", effect: "", scope: "public" as const, type: "string" as const, defaultValue: "" },
  { key: "admin_email", label: "管理员邮箱", description: "", effect: "", scope: "admin" as const, type: "string" as const, format: "email" as const, defaultValue: "" },
];

describe("createSystemConfigRegistry（P1-11）", () => {
  const registry = createSystemConfigRegistry(TEST_DEFS);

  it("返回注册表包含定义与键", () => {
    expect(registry.definitions).toHaveLength(5);
    expect(registry.keys).toEqual(["site_name", "site_enabled", "max_items", "public_title", "admin_email"]);
    expect(registry.publicKeys).toEqual(["public_title"]);
  });

  it("getDefinition 按 key 查找", () => {
    expect(registry.getDefinition("site_name")?.label).toBe("站点名称");
    expect(registry.getDefinition("not_exist")).toBeUndefined();
  });

  it("isSupported 判定", () => {
    expect(registry.isSupported("site_name")).toBe(true);
    expect(registry.isSupported("not_exist")).toBe(false);
  });

  it("isSensitive", () => {
    expect(registry.isSensitive("site_name")).toBe(false);
    // 未标记 sensitive 的 key 返回 false
  });

  it("normalizeValue — boolean", () => {
    expect(registry.normalizeValue("site_enabled", "true")).toEqual({ ok: true, value: "true" });
    expect(registry.normalizeValue("site_enabled", "false")).toEqual({ ok: true, value: "false" });
    expect(registry.normalizeValue("site_enabled", "yes").ok).toBe(false);
  });

  it("normalizeValue — integer", () => {
    expect(registry.normalizeValue("max_items", "50")).toEqual({ ok: true, value: "50" });
    expect(registry.normalizeValue("max_items", "0").ok).toBe(false); // min=1
    expect(registry.normalizeValue("max_items", "abc").ok).toBe(false);
  });

  it("normalizeValue — string", () => {
    expect(registry.normalizeValue("site_name", "我的商店")).toEqual({ ok: true, value: "我的商店" });
  });

  it("normalizeValue — email", () => {
    expect(registry.normalizeValue("admin_email", "admin@example.com")).toEqual({ ok: true, value: "admin@example.com" });
    expect(registry.normalizeValue("admin_email", "not-email").ok).toBe(false);
  });

  it("normalizeValue — 未注册 key 直接拒绝", () => {
    expect(registry.normalizeValue("unknown", "xxx").ok).toBe(false);
  });

  it("buildMap — 从 rows 构建有序 map", () => {
    const rows = [
      { key: "max_items", value: "20" },
      { key: "site_name", value: "Shop" },
    ];
    const map = registry.buildMap(rows);
    expect(map.site_name).toBe("Shop");
    expect(map.max_items).toBe("20");
    // 未在 rows 中的 key 为空字符串
    expect(map.site_enabled).toBe("");
  });

  it("customNormalize hook 优先于内置校验", () => {
    const r = createSystemConfigRegistry(TEST_DEFS, {
      customNormalize: (key, value) => {
        if (key === "site_name" && value === "bad") return { ok: false, message: "禁止名称" };
        return undefined;
      },
    });
    expect(r.normalizeValue("site_name", "bad")).toEqual({ ok: false, message: "禁止名称" });
    expect(r.normalizeValue("site_name", "good").ok).toBe(true);
  });
});