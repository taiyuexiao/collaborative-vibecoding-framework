import { describe, expect, it } from "vitest";
import { AppError } from "@superteam/core";
import { statusForError } from "./errors.js";

describe("statusForError", () => {
  it("六个业务错误码映射正确", () => {
    expect(statusForError(new AppError("VALIDATION_FAILED", "x"))).toBe(400);
    expect(statusForError(new AppError("NOT_FOUND", "x"))).toBe(404);
    expect(statusForError(new AppError("UNAUTHORIZED", "x"))).toBe(401);
    expect(statusForError(new AppError("ILLEGAL_TRANSITION", "x"))).toBe(409);
    expect(statusForError(new AppError("CYCLIC_DEPEND", "x"))).toBe(409);
    expect(statusForError(new AppError("CONFLICT", "x"))).toBe(409);
  });

  it("未知错误归 500", () => {
    expect(statusForError(new Error("boom"))).toBe(500);
    expect(statusForError("string error")).toBe(500);
  });
});
