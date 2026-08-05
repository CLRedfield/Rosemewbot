import { describe, expect, it } from "vitest";

import { createFirstSetupPlan, getRuntimeServicePresentation } from "../src/client/runtime-logic";
import type { DesktopRuntimeService, ServiceProbe } from "../src/client/types";

const stoppedService: DesktopRuntimeService = {
  id: "astrbot",
  installed: true,
  running: false,
  state: "stopped",
  status: "已安装，尚未启动",
  version: "4.27.1",
  startedAt: null,
};

const unreachableProbe: ServiceProbe = {
  id: "astrbot",
  label: "AstrBot",
  state: "unreachable",
  latencyMs: 12,
  detail: "连接失败，服务可能仍在启动",
  checkedAt: "2026-08-05T00:00:00.000Z",
};

describe("desktop runtime UI state", () => {
  it("continues from component installation to startup when QQ is already installed", () => {
    expect(createFirstSetupPlan(false, true)).toEqual(["install", "start"]);
  });

  it("installs every missing prerequisite before startup", () => {
    expect(createFirstSetupPlan(false, false)).toEqual(["install", "install-qq", "start"]);
    expect(createFirstSetupPlan(true, false)).toEqual(["install-qq", "start"]);
  });

  it("does not describe an installed but stopped component as unreachable", () => {
    expect(getRuntimeServicePresentation(stoppedService, unreachableProbe)).toEqual({
      state: "waiting",
      label: "未启动",
      detail: "已安装，尚未启动",
      canOpen: false,
    });
  });

  it("gives a freshly launched component time to become reachable", () => {
    const now = Date.parse("2026-08-05T00:00:30.000Z");
    const service = {
      ...stoppedService,
      running: true,
      state: "running" as const,
      status: "本机进程运行中",
      startedAt: "2026-08-05T00:00:00.000Z",
    };
    expect(getRuntimeServicePresentation(service, unreachableProbe, now)).toEqual({
      state: "waiting",
      label: "启动中",
      detail: "进程已启动，正在等待管理服务响应",
      canOpen: false,
    });
  });

  it("reports a persistent probe failure after the startup grace period", () => {
    const now = Date.parse("2026-08-05T00:01:00.000Z");
    const service = {
      ...stoppedService,
      running: true,
      state: "running" as const,
      status: "本机进程运行中",
      startedAt: "2026-08-05T00:00:00.000Z",
    };
    expect(getRuntimeServicePresentation(service, unreachableProbe, now)).toEqual({
      state: "unreachable",
      label: "运行异常",
      detail: unreachableProbe.detail,
      canOpen: false,
    });
  });
});
