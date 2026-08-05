import type {
  DesktopAction,
  DesktopRuntimeService,
  ServiceProbe,
  ServiceState,
} from "./types";

const STARTUP_GRACE_MS = 45_000;

export function createFirstSetupPlan(nativeReady: boolean, qqInstalled: boolean): DesktopAction[] {
  return [
    ...(!nativeReady ? ["install" as const] : []),
    ...(!qqInstalled ? ["install-qq" as const] : []),
    "start",
  ];
}

export interface RuntimeServicePresentation {
  state: ServiceState;
  label: string;
  detail: string;
  canOpen: boolean;
}

export function getRuntimeServicePresentation(
  service: DesktopRuntimeService | undefined,
  probe: ServiceProbe | undefined,
  now = Date.now(),
): RuntimeServicePresentation {
  if (!service?.installed) {
    return {
      state: "waiting",
      label: "未安装",
      detail: service?.status ?? "等待一键准备",
      canOpen: false,
    };
  }

  if (!service.running) {
    return {
      state: "waiting",
      label: "未启动",
      detail: service.status || "已安装，尚未启动",
      canOpen: false,
    };
  }

  if (probe?.state === "ready") {
    return {
      state: "ready",
      label: "可用",
      detail: probe.detail,
      canOpen: true,
    };
  }

  const startedAt = service.startedAt ? Date.parse(service.startedAt) : Number.NaN;
  const withinStartupGrace = Number.isFinite(startedAt)
    && now >= startedAt
    && now - startedAt < STARTUP_GRACE_MS;
  if (withinStartupGrace || !probe) {
    return {
      state: "waiting",
      label: "启动中",
      detail: "进程已启动，正在等待管理服务响应",
      canOpen: false,
    };
  }

  return {
    state: probe.state,
    label: probe.state === "waiting" ? "连接中" : "运行异常",
    detail: probe.detail,
    canOpen: false,
  };
}
