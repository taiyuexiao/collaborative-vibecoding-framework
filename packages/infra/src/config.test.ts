import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { AppError } from "@superteam/core";

describe("loadConfig", () => {
  it("无任何 env 时返回全默认值", () => {
    const c = loadConfig({});
    expect(c.port).toBe(7300);
    expect(c.host).toBe("127.0.0.1");
    expect(c.logLevel).toBe("info");
    expect(c.radarIntervalMs).toBe(30000);
    expect(c.llmBaseUrl).toBeUndefined();
  });

  it("env 覆盖默认值", () => {
    const c = loadConfig({
      SUPERTEAM_PORT: "8080",
      SUPERTEAM_DATA_DIR: "/tmp/st-data",
      SUPERTEAM_LLM_MODEL: "glm-5.3",
      SUPERTEAM_RADAR_INTERVAL_MS: "5000",
    });
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe("/tmp/st-data");
    expect(c.llmModel).toBe("glm-5.3");
    expect(c.radarIntervalMs).toBe(5000);
  });

  it("非法端口抛 AppError(VALIDATION_FAILED) 而非静默回退", () => {
    expect(() => loadConfig({ SUPERTEAM_PORT: "not-a-number" })).toThrowError(AppError);
    expect(() => loadConfig({ SUPERTEAM_PORT: "99999" })).toThrowError(AppError);
  });

  it("非法日志级别被拒绝", () => {
    expect(() => loadConfig({ SUPERTEAM_LOG_LEVEL: "loud" })).toThrowError(AppError);
  });

  it("llmBaseUrl 必须是合法 URL", () => {
    expect(() => loadConfig({ SUPERTEAM_LLM_BASEURL: "not-url" })).toThrowError(AppError);
    expect(loadConfig({ SUPERTEAM_LLM_BASEURL: "https://open.bigmodel.cn/api/paas/v4" }).llmBaseUrl).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
  });
});
