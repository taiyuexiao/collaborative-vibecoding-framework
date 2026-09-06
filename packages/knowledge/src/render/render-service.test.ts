import { describe, expect, it } from "vitest";
import { renderMarkdown, renderKnowledge } from "./render-service.js";

describe("renderMarkdown", () => {
  it("h2/h3 进 TOC，h1 不进；slug 唯一", () => {
    const body = "# 大标题\n\n## 支付流程\n\n### 回调处理\n\n### 回调处理\n\n## 退款\n";
    const { toc } = renderMarkdown(body);
    expect(toc.map((t) => `${t.level}:${t.slug}`)).toEqual([
      "2:支付流程",
      "3:回调处理",
      "3:回调处理-2",
      "2:退款",
    ]);
  });

  it("代码块内的 # 不误判为标题", () => {
    const body = "## 真标题\n\n```bash\n# 这是注释\nmake build\n```\n";
    const { toc, html } = renderMarkdown(body);
    expect(toc.length).toBe(1);
    expect(html).toContain("这是注释");
  });

  it("GFM 表格与删除线可渲染", () => {
    const body = "| a | b |\n|---|---|\n| 1 | 2 |\n\n~~删除~~\n";
    const { html } = renderMarkdown(body);
    expect(html).toContain("<table>");
    expect(html).toContain("<del>");
  });
});

describe("renderKnowledge", () => {
  it("meta 透出 front-matter 元数据", () => {
    const parsed = {
      path: "cards/x.md",
      dir: "cards",
      type: "card" as const,
      typeMismatch: false,
      frontmatter: {
        title: "坑卡",
        tags: ["java"],
        owner: "spl",
        expires: "2026-12-31",
      },
      body: "## 现象\nx",
    };
    const r = renderKnowledge(parsed);
    expect(r.meta.title).toBe("坑卡");
    expect(r.meta.expiresAt).toBe("2026-12-31");
    expect(r.meta.type).toBe("card");
    expect(r.html).toContain("现象");
  });
});
