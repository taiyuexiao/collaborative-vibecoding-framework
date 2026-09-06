import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(name: string, level = "info"): Logger {
  return pino({ level, base: { module: name } });
}
