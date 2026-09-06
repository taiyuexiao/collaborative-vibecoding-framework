import { describe, expect, it } from "vitest";
import {
  parseKnowledgeFile,
  serializeKnowledgeFile,
  slugify,
  typeOfDir,
  dirOfType,
} from "./frontmatter.js";
import { AppError } from "@superteam/core";

describe("知识对象模型", () => {
  it("目录与类型映射", () => {
    expect(typeOfDir("cards")).toBe("card");
    expect(typeOfDir("agents")).toBe("agent-doc");
    expect(typeOfDir("nope")).toBeNull();
    expect(dirOfType("spec")).toBe("specs");
  });

  it("合法解析：front-matter 分离 + 正文去首空行", () => {
    const raw = `---
title: 支付幂等坑
tags: [java, idempotency]
owner: spl
expires: 2026-12-31
---

## 现象
回调重复。`;
    const p = parseKnowledgeFile("cards/2026-09-06-pay.md", raw);
    expect(p.type).toBe("card");
    expect(p.typeMismatch).toBe(false);
    expect(p.frontmatter.title).toBe("支付幂等坑");
    expect(p.frontmatter.tags).toEqual(["java", "idempotency"]);
    expect(p.body).toBe("## 现象\n回调重复。");
  });

  it("type 与目录不一致 → typeMismatch 标记而非报错", () => {
    const raw = "---\ntitle: x\ntype: spec\n---\nbody";
    const p = parseKnowledgeFile("cards/2026-09-06-x.md", raw);
    expect(p.type).toBe("card");
    expect(p.typeMismatch).toBe(true);
  });

  it("未知目录拒绝", () => {
    expect(() => parseKnowledgeFile("misc/x.md", "---\ntitle: x\n---\n")).toThrowError(AppError);
  });

  it("缺 title / expires 非日期 / adr 非法 status 报 VALIDATION_FAILED", () => {
    expect(() => parseKnowledgeFile("cards/x.md", "---\ntitle: ''\n---\n")).toThrowError(AppError);
    expect(() =>
      parseKnowledgeFile("cards/x.md", "---\ntitle: x\nexpires: 明天\n---\n"),
    ).toThrowError(AppError);
    expect(() =>
      parseKnowledgeFile("adr/0001-x.md", "---\ntitle: x\nstatus: maybe\n---\n"),
    ).toThrowError(AppError);
    // card 的 status 不限枚举
    expect(() => parseKnowledgeFile("cards/x.md", "---\ntitle: x\nstatus: whatever\n---\n")).not.toThrow();
  });

  it("serialize→parse roundtrip 稳定", () => {
    const fm = { title: "决策：引入 FTS", type: "adr", status: "accepted", tags: ["search"] };
    const body = "# 决策\n内容。";
    const file = serializeKnowledgeFile(fm, body);
    const p = parseKnowledgeFile("adr/0001-fts.md", file);
    expect(p.frontmatter.title).toBe("决策：引入 FTS");
    expect(p.frontmatter.status).toBe("accepted");
    // gray-matter stringify 会在正文尾部补一个换行，解析时保留（无害）
    expect(p.body.replace(/\n$/, "")).toBe(body);
  });

  it("slugify：CJK 保留、ASCII 小写、符号剔除", () => {
    expect(slugify("支付 回调 幂等")).toBe("支付-回调-幂等");
    expect(slugify("Fix: Auth Token (v2)")).toBe("fix-auth-token-v2");
    expect(slugify("  --hello--world!!  ")).toBe("hello-world");
  });
});
