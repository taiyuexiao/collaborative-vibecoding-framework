import { AppError, ERROR_CODES } from "@superteam/core";

const STATUS_BY_CODE: Record<(typeof ERROR_CODES)[number], number> = {
  ILLEGAL_TRANSITION: 409,
  CYCLIC_DEPEND: 409,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
};

export function statusForError(err: unknown): number {
  if (err instanceof AppError) {
    return STATUS_BY_CODE[err.code] ?? 500;
  }
  return 500;
}
