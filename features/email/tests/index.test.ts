import { describe, it, expect } from "vitest";
import { escapeHtml, interpolate } from "../index";

describe("escapeHtml", () => {
  it("转义特殊字符", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    );
  });

  it("普通文本不变", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("转义 & 和引号", () => {
    expect(escapeHtml('a & b "c"')).toBe("a &amp; b &quot;c&quot;");
  });
});

describe("interpolate", () => {
  it("替换变量", () => {
    const result = interpolate("Hello {{name}}, your order is {{orderNo}}", {
      name: "Alice",
      orderNo: "12345",
    });
    expect(result).toBe("Hello Alice, your order is 12345");
  });

  it("缺失变量替换为空", () => {
    const result = interpolate("Hello {{name}}", {});
    expect(result).toBe("Hello ");
  });

  it("变量值自动 HTML 转义", () => {
    const result = interpolate("{{content}}", { content: "<b>bold</b>" });
    expect(result).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("条件块", () => {
    const template = "{{#if showNote}}Note: {{note}}{{/if}}";
    expect(interpolate(template, { showNote: "yes", note: "hello" })).toBe("Note: hello");
    expect(interpolate(template, { note: "hello" })).toBe("");
  });
});
