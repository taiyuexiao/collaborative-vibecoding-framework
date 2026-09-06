export const ERROR_CODES = [
  "ILLEGAL_TRANSITION",
  "CYCLIC_DEPEND",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "CONFLICT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}
