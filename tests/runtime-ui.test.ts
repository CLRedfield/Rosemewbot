import { describe, expect, it } from "vitest";

import { createFirstSetupPlan, getQQSessionPresentation, getRuntimeProgressHeadline, getRuntimeServicePresentation } from "../src/client/runtime-logic";
import type { DesktopInstallProgress, DesktopQQSessionStatus, DesktopRuntimeService, ServiceProbe } from "../src/client/types";

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

  it.each([
    ["online", "ready", "QQ 在线", true],
    ["logged-out", "waiting", "QQ 未登录", false],
    ["offline", "unreachable", "QQ 已掉线", false],
    ["unknown", "waiting", "状态待确认", false],
  ] satisfies [DesktopQQSessionStatus["state"], string, string, boolean][])("presents the live QQ %s state without confusing WebUI reachability", (state, presentationState, label, online) => {
    expect(getQQSessionPresentation({
      state,
      account: null,
      nickname: null,
      checkedAt: "2026-08-07T07:00:00.000Z",
      detail: "实时状态说明",
    })).toEqual({
      state: presentationState,
      label,
      detail: "实时状态说明",
      online,
    });
  });

  it.each([
    [
      { stage: "downloading", component: "astrbot", percent: 12, detail: "准备运行工具" },
      "正在叼回 Python……",
    ],
    [
      { stage: "configuring", component: "astrbot", percent: 50, detail: "正在初始化 AstrBot" },
      "正在把 AstrBot 安顿好……",
    ],
    [
      { stage: "installing", component: "napcat", percent: 84, detail: "正在安装 NapCat" },
      "正在给 NapCat 铺猫窝……",
    ],
    [
      { stage: "waiting", component: "qq", percent: 75, detail: "请完成 QQ 安装" },
      "QQ 已到门口，等你开门……",
    ],
  ] satisfies [DesktopInstallProgress, string][])("adds stable flavor copy to %s progress", (progress, headline) => {
    expect(getRuntimeProgressHeadline(progress)).toBe(headline);
  });
});
