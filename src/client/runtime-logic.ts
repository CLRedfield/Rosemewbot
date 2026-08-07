import type {
  DesktopQQSessionStatus,
  DesktopAction,
  DesktopInstallProgress,
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

export function getRuntimeProgressHeadline(progress: DesktopInstallProgress): string {
  if (progress.stage === "error") return "猫窝出了点状况……";
  if (progress.stage === "complete") return "都收拾好了。";

  switch (progress.component) {
    case "astrbot":
      return progress.stage === "configuring"
        ? "正在把 AstrBot 安顿好……"
        : "正在叼回 Python……";
    case "napcat":
      return "正在给 NapCat 铺猫窝……";
    case "qq":
      return progress.stage === "waiting"
        ? "QQ 已到门口，等你开门……"
        : "正在请 QQ 进屋……";
    case "runtime":
      return "正在整理机器人的小窝……";
  }
}

export interface RuntimeServicePresentation {
  state: ServiceState;
  label: string;
  detail: string;
  canOpen: boolean;
}

export interface QQSessionPresentation {
  state: ServiceState;
  label: string;
  detail: string;
  online: boolean;
}

export function getQQSessionPresentation(session: DesktopQQSessionStatus): QQSessionPresentation {
  switch (session.state) {
    case "online":
      return {
        state: "ready",
        label: "QQ 在线",
        detail: session.detail,
        online: true,
      };
    case "offline":
      return {
        state: "unreachable",
        label: "QQ 已掉线",
        detail: session.detail,
        online: false,
      };
    case "logged-out":
      return {
        state: "waiting",
        label: "QQ 未登录",
        detail: session.detail,
        online: false,
      };
    case "unknown":
      return {
        state: "waiting",
        label: "状态待确认",
        detail: session.detail,
        online: false,
      };
  }
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
