import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bot,
  Cable,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  History,
  KeyRound,
  LogIn,
  MessageCircle,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Download,
  Power,
  Wifi,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DesktopAcceptanceState,
  DesktopAction,
  DesktopCredentials,
  DesktopDiagnosticAction,
  DesktopDiagnosticReport,
  DesktopInstallProgress,
  DesktopPreferences,
  DesktopRuntimeState,
  EmbeddedPanelBounds,
  EmbeddedPanelId,
  EmbeddedPanelState,
  PublicConfig,
  ServiceProbe,
  StackStatus,
  ViewId,
} from "./types";

const fallbackConfig: PublicConfig = {
  astrbotUrl: "http://localhost:6185",
  napcatUrl: "http://localhost:6099/webui",
  onebotUrl: "ws://127.0.0.1:6199/ws",
  bindMode: "local",
};

const emptyStatus: StackStatus = {
  overall: "starting",
  checkedAt: new Date(0).toISOString(),
  services: [],
};

const emptyAcceptance: DesktopAcceptanceState = {
  componentsReady: false,
  servicesReady: false,
  qqInstalled: false,
  qqLoginDetected: false,
  qqAccount: null,
  onebotConfigured: false,
  onebotConnected: false,
  modelConfigured: false,
  modelName: null,
};

const manualStepIds = ["qq-login", "model", "test"] as const;
type ManualStepId = (typeof manualStepIds)[number];
type ThemeMode = "system" | "light" | "dark";

const themeStorageKey = "rosemewbot-theme";
const legacyThemeStorageKey = "agent-space-theme";
const onboardingStorageKey = "rosemewbot-onboarding";
const legacyOnboardingStorageKey = "agent-space-onboarding";
const themeModes: ThemeMode[] = ["system", "light", "dark"];

function readThemePreference(): ThemeMode {
  try {
    const stored = localStorage.getItem(themeStorageKey) ?? localStorage.getItem(legacyThemeStorageKey);
    return themeModes.includes(stored as ThemeMode) ? stored as ThemeMode : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(mode: ThemeMode) {
  return mode === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : mode;
}

function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0b0f12" : "#f3f5f2");
}

applyTheme(readThemePreference());

function useThemePreference() {
  const [theme, setTheme] = useState<ThemeMode>(readThemePreference);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // The theme still works for this session if storage is unavailable.
    }
    void window.rosemewbotDesktop?.setTheme(theme);

    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (theme === "system") applyTheme("system");
    };
    systemTheme.addEventListener("change", handleSystemThemeChange);
    return () => systemTheme.removeEventListener("change", handleSystemThemeChange);
  }, [theme]);

  return { theme, setTheme };
}

const serviceCopy: Record<
  ServiceProbe["state"],
  { label: string; className: string }
> = {
  ready: { label: "已就绪", className: "is-ready" },
  waiting: { label: "待配置", className: "is-waiting" },
  unreachable: { label: "不可达", className: "is-error" },
};

function usePersistentSteps() {
  const [completed, setCompleted] = useState<Set<ManualStepId>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(onboardingStorageKey) ?? localStorage.getItem(legacyOnboardingStorageKey) ?? "[]") as string[];
      return new Set(stored.filter((item): item is ManualStepId => manualStepIds.includes(item as ManualStepId)));
    } catch {
      return new Set();
    }
  });

  const toggle = (step: ManualStepId) => {
    setCompleted((previous) => {
      const next = new Set(previous);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      localStorage.setItem(onboardingStorageKey, JSON.stringify([...next]));
      return next;
    });
  };

  return { completed, toggle };
}

function StatusPill({ state, detail = false }: { state: ServiceProbe["state"]; detail?: boolean }) {
  const copy = serviceCopy[state];
  return (
    <span className={`status-pill ${copy.className}`}>
      <span className="status-dot" />
      {detail ? copy.label : <span className="sr-only">{copy.label}</span>}
    </span>
  );
}

function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button className="copy-button" type="button" onClick={handleCopy} aria-label={`${label} ${value}`}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "已复制" : label}
    </button>
  );
}

function OnboardingCredentials() {
  const desktop = window.rosemewbotDesktop;
  const [credentials, setCredentials] = useState<DesktopCredentials | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!desktop) return null;

  const toggle = async () => {
    if (!credentials) {
      setLoading(true);
      try {
        setCredentials(await desktop.getCredentials());
      } finally {
        setLoading(false);
      }
    }
    setVisible((current) => !current);
  };

  return (
    <section className="onboarding-credentials">
      <div className="credential-heading">
        <div><KeyRound size={16} /><span><strong>后台登录凭据</strong><small>打开完整设置时复制粘贴</small></span></div>
        <button className="copy-button" type="button" onClick={() => void toggle()} disabled={loading}>
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          {loading ? "读取中" : visible ? "隐藏" : "显示"}
        </button>
      </div>
      {!visible && <p>凭据由 Rosemewbot 在本机生成，仅在你主动展开时显示。</p>}
      {visible && credentials && (
        <div className="credential-list onboarding-credential-list">
          <div><span>AstrBot 用户名</span><code>{credentials.astrbotUsername}</code><CopyButton value={credentials.astrbotUsername} /></div>
          <div><span>AstrBot 密码</span><code>{credentials.astrbotPassword}</code><CopyButton value={credentials.astrbotPassword} /></div>
          <div><span>NapCat 登录 Token</span><code>{credentials.napcatToken}</code><CopyButton value={credentials.napcatToken} /></div>
        </div>
      )}
    </section>
  );
}

function PreferenceToggle({
  label,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button className="preference-row" type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <span className={`switch-control ${checked ? "switch-on" : ""}`} aria-hidden="true"><span /></span>
    </button>
  );
}

function ExternalButton({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a className={`button ${primary ? "button-primary" : "button-secondary"}`} href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={15} />
    </a>
  );
}

function ServiceOpenButton({ panel, href, children, primary = false, disabled = false }: { panel: "astrbot" | "napcat"; href: string; children: React.ReactNode; primary?: boolean; disabled?: boolean }) {
  if (!window.rosemewbotDesktop) return <ExternalButton href={href} primary={primary}>{children}</ExternalButton>;
  return (
    <button className={`button ${primary ? "button-primary" : "button-secondary"}`} type="button" disabled={disabled} onClick={() => void window.rosemewbotDesktop?.openPanel(panel)}>
      {children}
      <ExternalLink size={15} />
    </button>
  );
}

function PanelTextLink({ panel, href }: { panel: "astrbot" | "napcat"; href: string }) {
  if (!window.rosemewbotDesktop) return <a href={href} target="_blank" rel="noreferrer">{href}</a>;
  return <button className="text-link" type="button" onClick={() => void window.rosemewbotDesktop?.openPanel(panel)}>{href}</button>;
}

function boundsForElement(element: HTMLElement): EmbeddedPanelBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function EmbeddedPanelWorkspace({ panel, runtime, suspended = false }: { panel: EmbeddedPanelId; runtime: DesktopRuntimeState | null; suspended?: boolean }) {
  const desktop = window.rosemewbotDesktop;
  const hostRef = useRef<HTMLDivElement>(null);
  const label = panel === "napcat" ? "NapCat" : "AstrBot";
  const description = panel === "napcat" ? "QQ 登录与 OneBot 网络" : "模型、机器人、知识库与插件";
  const service = runtime?.services.find((item) => item.id === panel);
  const running = Boolean(service?.running);
  const [panelState, setPanelState] = useState<EmbeddedPanelState>({
    panel,
    state: "loading",
    message: `正在载入 ${label} 设置`,
  });

  useEffect(() => {
    if (!desktop) return;
    if (suspended) {
      void desktop.hidePanel(panel);
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    let animationFrame = 0;
    let firstLayout = true;

    const syncBounds = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const bounds = boundsForElement(host);
        if (bounds.width < 2 || bounds.height < 2) return;
        const request = firstLayout
          ? desktop.showPanel(panel, bounds)
          : desktop.setPanelBounds(panel, bounds);
        firstLayout = false;
        void request.catch((error: unknown) => {
          setPanelState({
            panel,
            state: "error",
            message: error instanceof Error ? error.message : `${label} 设置暂时无法访问`,
          });
        });
      });
    };

    const unsubscribe = desktop.onPanelState((next) => {
      if (next.panel === panel) setPanelState(next);
    });
    const observer = new ResizeObserver(syncBounds);
    observer.observe(host);
    window.addEventListener("resize", syncBounds);
    syncBounds();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      unsubscribe();
      void desktop.hidePanel(panel);
    };
  }, [desktop, label, panel, suspended]);

  const reload = async () => {
    if (!desktop) return;
    setPanelState({ panel, state: "loading", message: `正在重新载入 ${label} 设置` });
    try {
      await desktop.reloadPanel(panel);
    } catch (error) {
      setPanelState({
        panel,
        state: "error",
        message: error instanceof Error ? error.message : `${label} 设置暂时无法访问`,
      });
    }
  };

  return (
    <section className="embedded-workspace view-enter" aria-label={`${label} 内嵌设置`}>
      <header className="embedded-toolbar">
        <div className={`embedded-product-icon embedded-${panel}`} aria-hidden="true">
          {panel === "napcat" ? <Bot size={19} /> : <Server size={19} />}
        </div>
        <div className="embedded-product-copy">
          <div><strong>{label}</strong><span>内嵌工作区</span></div>
          <small>{description}</small>
        </div>
        <div className={`embedded-service-state ${running ? "is-running" : ""}`}>
          <span />
          {running ? "服务运行中" : service?.installed ? "服务未启动" : "组件未准备"}
        </div>
        <div className={`embedded-load-state state-${panelState.state}`} role="status" aria-live="polite">
          {panelState.state === "loading" && <RefreshCw size={13} className="spin" />}
          {panelState.state === "ready" && <Check size={13} />}
          {panelState.state === "error" && <CircleAlert size={13} />}
          <span>{panelState.state === "loading" ? "载入中" : panelState.state === "ready" ? "已连接" : "连接失败"}</span>
        </div>
        <button className="embedded-reload" type="button" onClick={() => void reload()} title={`重新载入 ${label}`}>
          <RefreshCw size={15} />
          重新载入
        </button>
      </header>
      <div className={`embedded-panel-host host-${panelState.state}`} ref={hostRef}>
        <div className="embedded-placeholder">
          {panelState.state === "error" ? <CircleAlert size={28} /> : panel === "napcat" ? <Bot size={28} /> : <Server size={28} />}
          <strong>{panelState.state === "error" ? `${label} 暂时无法打开` : `正在打开 ${label}`}</strong>
          <p>{panelState.state === "error" ? panelState.message : "完整设置会显示在这个区域，切换页面不会丢失当前进度。"}</p>
          {panelState.state === "error" && <button className="button button-secondary" type="button" onClick={() => void reload()}><RefreshCw size={14} />重试</button>}
        </div>
      </div>
    </section>
  );
}

function Sidebar({ view, onViewChange, desktop, theme, onThemeChange, onClose }: { view: ViewId; onViewChange: (view: ViewId) => void; desktop: boolean; theme: ThemeMode; onThemeChange: (theme: ThemeMode) => void; onClose?: () => void }) {
  const workspaceNav = [
    ...(desktop ? [{ id: "runtime" as const, label: "运行控制", icon: Power }] : []),
    ...(desktop ? [
      { id: "napcat" as const, label: "NapCat 设置", icon: Bot },
      { id: "astrbot" as const, label: "AstrBot 设置", icon: Server },
    ] : []),
  ];
  const supportNav = [
    { id: "onboarding" as const, label: "接入向导", icon: Cable },
    { id: "status" as const, label: "运行状态", icon: Gauge },
    { id: "diagnostics" as const, label: "故障诊断", icon: Wrench },
  ];

  const renderNav = (label: string, items: typeof workspaceNav | typeof supportNav) => (
    <nav className="nav-section" aria-label={label}>
      <span className="nav-section-label">{label}</span>
      {items.map(({ id, label: itemLabel, icon: Icon }) => (
        <button
          className={view === id ? "active" : ""}
          key={id}
          type="button"
          onClick={() => {
            onViewChange(id);
            onClose?.();
          }}
        >
          <Icon size={17} strokeWidth={1.8} />
          {itemLabel}
          {view === id && <ChevronRight className="nav-arrow" size={15} />}
        </button>
      ))}
    </nav>
  );

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <div>
          <strong>Rosemewbot</strong>
          <span>QQ 机器人助手</span>
        </div>
        {onClose && (
          <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="关闭导航">
            <X size={18} />
          </button>
        )}
      </div>

      {workspaceNav.length > 0 && renderNav("工作区", workspaceNav)}
      {renderNav("支持", supportNav)}

      <div className="theme-control">
        <div className="theme-control-heading">
          <span>界面主题</span>
          <small>{theme === "system" ? "跟随 Windows" : theme === "light" ? "亮色" : "暗色"}</small>
        </div>
        <div className="theme-options" role="group" aria-label="界面主题">
          {([
            { id: "system" as const, label: "系统", icon: Monitor },
            { id: "light" as const, label: "亮色", icon: Sun },
            { id: "dark" as const, label: "暗色", icon: Moon },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              className={theme === id ? "active" : ""}
              key={id}
              type="button"
              aria-pressed={theme === id}
              title={id === "system" ? "跟随 Windows 主题" : `切换为${label}主题`}
              onClick={() => onThemeChange(id)}
            >
              <Icon size={13} strokeWidth={1.9} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-note">
        <ShieldAlert size={16} />
        <div>
          <strong>试点通道</strong>
          <p>NapCat 使用普通 QQ 协议，不等同于 QQ 官方机器人。</p>
        </div>
      </div>

      <div className="sidebar-version">Phase A · Native v0.5</div>
    </aside>
  );
}

function Topbar({ status, acceptance, checking, onRefresh, onMenu }: { status: StackStatus; acceptance: DesktopAcceptanceState | null; checking: boolean; onRefresh: () => void; onMenu: () => void }) {
  const ready = acceptance ? acceptance.servicesReady && acceptance.onebotConnected && acceptance.modelConfigured : status.overall === "ready";
  const stateLabel = checking ? "正在检查" : ready ? "链路可用" : "等待组件";
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="打开导航">
        <SlidersHorizontal size={18} />
      </button>
      <div className="environment">
        <span className={`environment-dot ${ready ? "online" : ""}`} />
        <span>本地试点环境</span>
        <span className="environment-state">{stateLabel}</span>
      </div>
      <button className="refresh-button" type="button" onClick={onRefresh} disabled={checking}>
        <RefreshCw size={15} className={checking ? "spin" : ""} />
        重新检查
      </button>
    </header>
  );
}

function RiskNotice({ bindMode }: { bindMode: PublicConfig["bindMode"] }) {
  return (
    <div className={`risk-notice ${bindMode === "network" ? "risk-high" : ""}`}>
      <CircleAlert size={17} />
      <p>
        <strong>{bindMode === "local" ? "当前仅本机可访问。" : "当前允许局域网访问。"}</strong>
        这一接入方式适合内部试点；正式对外服务请切换 QQ 官方机器人，并补充账号风控与合规评估。
      </p>
    </div>
  );
}

interface OnboardingProps {
  config: PublicConfig;
  status: StackStatus;
  acceptance: DesktopAcceptanceState | null;
  checking: boolean;
  onRefresh: () => void;
  completed: Set<ManualStepId>;
  onToggle: (step: ManualStepId) => void;
}

function Onboarding({ config, status, acceptance, checking, onRefresh, completed, onToggle }: OnboardingProps) {
  const byId = useMemo(() => new Map(status.services.map((service) => [service.id, service])), [status.services]);
  const automatic = Boolean(acceptance);
  const servicesReady = acceptance?.servicesReady ?? (byId.get("napcat")?.state === "ready" && byId.get("astrbot")?.state === "ready");
  const qqLoginReady = acceptance?.qqLoginDetected ?? completed.has("qq-login");
  const onebotReady = acceptance?.onebotConnected ?? (byId.get("onebot")?.state === "ready");
  const modelReady = acceptance?.modelConfigured ?? completed.has("model");
  const progress = [servicesReady, qqLoginReady, onebotReady, modelReady, completed.has("test")];
  const completedCount = progress.filter(Boolean).length;

  return (
    <div className="view-enter">
      <section className="page-heading">
        <div>
          <span className="eyebrow">FIRST CONNECTION</span>
          <h1>把 QQ 接到你的机器人</h1>
          <p>按顺序完成五项检查。NapCat 已预设本机反向 WebSocket，不需要容器地址或命令行。</p>
        </div>
        <div className="progress-summary" aria-label={`接入进度 ${completedCount}/5`}>
          <strong>{completedCount}<span>/5</span></strong>
          <div>
            <span>接入进度</span>
            <div className="progress-track"><span style={{ width: `${completedCount * 20}%` }} /></div>
          </div>
        </div>
      </section>

      <RiskNotice bindMode={config.bindMode} />

      <div className="workspace-grid">
        <div className="steps-list">
          <WizardStep
            number="01"
            title="确认基础服务"
            description="先确认 AstrBot 与 NapCat 已经启动。首次准备由桌面应用自动完成，可能需要几分钟。"
            done={servicesReady}
            current={!servicesReady}
          >
            <div className="inline-statuses">
              {["napcat", "astrbot"].map((id) => {
                const service = byId.get(id as ServiceProbe["id"]);
                return (
                  <div className="inline-service" key={id}>
                    <StatusPill state={service?.state ?? "waiting"} />
                    <span>{id === "napcat" ? "NapCat" : "AstrBot"}</span>
                    <small>{service?.detail ?? "等待首次探测"}</small>
                  </div>
                );
              })}
            </div>
            <button className="button button-secondary" type="button" onClick={onRefresh} disabled={checking}>
              <RefreshCw size={15} className={checking ? "spin" : ""} />
              检查服务
            </button>
          </WizardStep>

          <WizardStep
            number="02"
            title="登录机器人 QQ"
            description={acceptance?.qqAccount ? `已自动识别机器人账号 ${acceptance.qqAccount}。建议始终使用独立账号，不要使用主账号。` : "打开 NapCat，在 WebUI 中扫码登录专用 QQ。登录完成后这里会自动识别账号。"}
            done={qqLoginReady}
            current={servicesReady && !qqLoginReady}
          >
            <div className="action-row">
              <ServiceOpenButton panel="napcat" href={config.napcatUrl} primary>打开 NapCat</ServiceOpenButton>
              {automatic
                ? <span className={`auto-check ${qqLoginReady ? "auto-check-ready" : ""}`}><LogIn size={14} />{qqLoginReady ? `QQ ${acceptance?.qqAccount}` : "等待扫码登录"}</span>
                : <CompletionButton done={completed.has("qq-login")} onClick={() => onToggle("qq-login")} />}
            </div>
          </WizardStep>

          <WizardStep
            number="03"
            title="确认 OneBot 通道"
            description="AstrBot 的 OneBot v11 适配器已预配置为本机 6199 端口；这里检查的是真实 TCP 连接，不再只判断端口是否打开。"
            done={onebotReady}
            current={qqLoginReady && !onebotReady}
          >
            <div className="config-strip">
              <code>{config.onebotUrl}</code>
              <CopyButton value={config.onebotUrl} label="复制地址" />
            </div>
            <div className="muted-line">
              <StatusPill state={onebotReady ? "ready" : "waiting"} detail />
              <span>{onebotReady ? "NapCat 已与 AstrBot 建立 WebSocket 连接" : acceptance?.onebotConfigured ? "配置正确，等待 NapCat 连接" : "OneBot 配置需要修复"}</span>
            </div>
          </WizardStep>

          <WizardStep
            number="04"
            title="配置模型"
            description="在 AstrBot 中添加 OpenAI-compatible 模型提供商，并设为默认聊天模型。API Key 只保存在本机 AstrBot 数据目录。"
            done={modelReady}
            current={onebotReady && !modelReady}
          >
            <div className="action-row">
              <ServiceOpenButton panel="astrbot" href={config.astrbotUrl} primary>打开 AstrBot</ServiceOpenButton>
              {automatic
                ? <span className={`auto-check ${modelReady ? "auto-check-ready" : ""}`}><BadgeCheck size={14} />{modelReady ? acceptance?.modelName ?? "已识别默认模型" : "等待配置模型"}</span>
                : <CompletionButton done={completed.has("model")} onClick={() => onToggle("model")} />}
            </div>
          </WizardStep>

          <WizardStep
            number="05"
            title="发送首条测试消息"
            description="把机器人拉进测试群，@它发送“你好”。确认 QQ 收到回复后，再接入真实玩家群。"
            done={completed.has("test")}
            current={modelReady && !completed.has("test")}
            last
          >
            <div className="message-sample">
              <MessageCircle size={16} />
              <code>@机器人 你好，请回复“接入成功”</code>
              <CopyButton value="@机器人 你好，请回复“接入成功”" label="复制测试语" />
            </div>
            <CompletionButton done={completed.has("test")} onClick={() => onToggle("test")} label="已收到回复" />
          </WizardStep>
        </div>

        <div className="onboarding-aside">
          <ConnectionRail status={status} completed={completed} acceptance={acceptance} />
          <OnboardingCredentials />
        </div>
      </div>
    </div>
  );
}

function WizardStep({ number, title, description, done, current, last = false, children }: { number: string; title: string; description: string; done: boolean; current: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <section className={`wizard-step ${done ? "step-done" : ""} ${current ? "step-current" : ""}`}>
      <div className="step-marker-column">
        <div className="step-marker">{done ? <Check size={15} /> : number}</div>
        {!last && <div className="step-line" />}
      </div>
      <div className="step-content">
        <div className="step-title-row">
          <h2>{title}</h2>
          {done && <span className="done-label">完成</span>}
        </div>
        <p>{description}</p>
        <div className="step-actions">{children}</div>
      </div>
    </section>
  );
}

function CompletionButton({ done, onClick, label = "我已完成" }: { done: boolean; onClick: () => void; label?: string }) {
  return (
    <button className={`button ${done ? "button-complete" : "button-secondary"}`} type="button" onClick={onClick}>
      {done ? <Check size={15} /> : <ClipboardCheck size={15} />}
      {done ? "已完成" : label}
    </button>
  );
}

function ConnectionRail({ status, completed, acceptance }: { status: StackStatus; completed: Set<ManualStepId>; acceptance: DesktopAcceptanceState | null }) {
  const byId = new Map(status.services.map((service) => [service.id, service]));
  const nodes = [
    { label: acceptance?.qqAccount ? `QQ ${acceptance.qqAccount}` : "QQ 账号", icon: MessageCircle, state: (acceptance?.qqLoginDetected ?? completed.has("qq-login")) ? "ready" : "waiting" },
    { label: "NapCat", icon: Bot, state: byId.get("napcat")?.state ?? "waiting" },
    { label: "OneBot 11", icon: Cable, state: acceptance ? acceptance.onebotConnected ? "ready" : "waiting" : byId.get("onebot")?.state ?? "waiting" },
    { label: "AstrBot", icon: Server, state: byId.get("astrbot")?.state ?? "waiting" },
    { label: acceptance?.modelName ?? "模型", icon: KeyRound, state: (acceptance?.modelConfigured ?? completed.has("model")) ? "ready" : "waiting" },
  ] as const;

  return (
    <aside className="connection-rail">
      <div className="rail-heading">
        <span>实时链路</span>
        <Activity size={16} />
      </div>
      <div className="flow-nodes">
        {nodes.map(({ label, icon: Icon, state }, index) => (
          <div className="flow-node-wrap" key={label}>
            <div className={`flow-node ${state === "ready" ? "node-ready" : ""}`}>
              <Icon size={18} />
              <div><strong>{label}</strong><span>{state === "ready" ? "已连接" : "等待中"}</span></div>
              <StatusPill state={state} />
            </div>
            {index < nodes.length - 1 && <div className={`flow-connector ${state === "ready" ? "connector-ready" : ""}`}><ArrowRight size={14} /></div>}
          </div>
        ))}
      </div>
      <div className="rail-footnote">
        <TerminalSquare size={15} />
        <span>状态每 15 秒自动刷新。组件、QQ、OneBot 与模型均自动验收，最终回复由你确认。</span>
      </div>
    </aside>
  );
}

function StatusView({ status, config, acceptance, checking, onRefresh }: { status: StackStatus; config: PublicConfig; acceptance: DesktopAcceptanceState | null; checking: boolean; onRefresh: () => void }) {
  const serviceState = (service: ServiceProbe) => service.id === "onebot" && acceptance
    ? acceptance.onebotConnected ? "ready" as const : "waiting" as const
    : service.state;
  const ready = status.services.filter((service) => serviceState(service) === "ready").length;
  const actualReady = acceptance ? acceptance.servicesReady && acceptance.onebotConnected && acceptance.modelConfigured : status.overall === "ready";
  return (
    <div className="view-enter">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">RUNTIME</span>
          <h1>运行状态</h1>
          <p>这里显示整合层能够独立验证的网络状态，不会读取聊天内容或 API Key。</p>
        </div>
        <button className="button button-primary" type="button" onClick={onRefresh} disabled={checking}>
          <RefreshCw size={15} className={checking ? "spin" : ""} />
          立即探测
        </button>
      </section>

      <div className="status-overview">
        <div><span>可用组件</span><strong>{ready}<small>/3</small></strong></div>
        <div><span>链路状态</span><strong className="textual-status">{actualReady ? "可用" : status.overall === "starting" ? "启动中" : "需处理"}</strong></div>
        <div><span>访问范围</span><strong className="textual-status">{config.bindMode === "local" ? "仅本机" : "局域网"}</strong></div>
      </div>

      <section className="service-table" aria-label="服务状态">
        <div className="service-table-head"><span>组件</span><span>状态</span><span>延迟</span><span>说明</span><span>入口</span></div>
        {status.services.map((service) => (
          <div className="service-row" key={service.id}>
            <div className="service-name">
              {service.id === "napcat" ? <Bot size={17} /> : service.id === "astrbot" ? <Server size={17} /> : <Cable size={17} />}
              <strong>{service.label}</strong>
            </div>
            <StatusPill state={serviceState(service)} detail />
            <span className="latency">{service.latencyMs === null ? "—" : `${service.latencyMs} ms`}</span>
            <span className="service-detail">{service.id === "onebot" && acceptance ? acceptance.onebotConnected ? "NapCat 已建立真实 WebSocket 连接" : "6199 端口可用，等待 NapCat 连接" : service.detail}</span>
            {service.id === "napcat" ? <ServiceOpenButton panel="napcat" href={config.napcatUrl}>打开</ServiceOpenButton> : service.id === "astrbot" ? <ServiceOpenButton panel="astrbot" href={config.astrbotUrl}>打开</ServiceOpenButton> : <CopyButton value={config.onebotUrl} />}
          </div>
        ))}
        {status.services.length === 0 && <div className="empty-state">等待第一次状态探测…</div>}
      </section>

      <div className="observability-note">
        <Wifi size={18} />
        <div><strong>真实连接验收</strong><p>OneBot 状态现在要求 6199 端口存在实际的 ESTABLISHED 连接；只有监听端口不会显示为链路可用。</p></div>
      </div>
    </div>
  );
}

function RuntimeView({ runtime, status, config, checking, onRefresh }: { runtime: DesktopRuntimeState | null; status: StackStatus; config: PublicConfig; checking: boolean; onRefresh: () => Promise<void> | void }) {
  const desktop = window.rosemewbotDesktop;
  const [activeAction, setActiveAction] = useState<DesktopAction | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string; code?: string } | null>(null);
  const [logService, setLogService] = useState<"astrbot" | "napcat">("astrbot");
  const [logs, setLogs] = useState("选择组件后读取最近日志。\n日志中的本地凭据会自动脱敏。");
  const [logsLoading, setLogsLoading] = useState(false);
  const [credentials, setCredentials] = useState<DesktopCredentials | null>(null);
  const [credentialsVisible, setCredentialsVisible] = useState(false);
  const [preferences, setPreferences] = useState<DesktopPreferences>(runtime?.preferences ?? {
    launchAtLogin: false,
    startBotAtLogin: false,
    autoRecovery: true,
  });

  useEffect(() => {
    if (runtime?.preferences) setPreferences(runtime.preferences);
  }, [runtime?.preferences]);

  const stackState = runtime?.stackState ?? "unavailable";
  const running = stackState === "running";
  const supported = runtime?.platformSupported ?? true;
  const nativeReady = runtime?.nativeReady ?? false;
  const qqInstalled = runtime?.qqInstalled ?? false;
  const needsSetup = supported && !nativeReady;
  const needsQQ = supported && nativeReady && !qqInstalled;
  const unavailable = !supported || !nativeReady || !qqInstalled;
  const busy = Boolean(activeAction || runtime?.busy);
  const progress = runtime?.installProgress;
  const progressActive = Boolean(activeAction && ["install", "install-qq", "update", "repair", "rollback"].includes(activeAction));
  const compatibility = runtime?.compatibility;
  const compatibilityUpdateAvailable = compatibility?.components.some((component) => (
    component.id !== "qq" && (component.status === "update-available" || component.status === "unknown")
  )) ?? false;
  const stateCopy = !supported
    ? { label: "不支持此系统", tone: "error" }
    : needsSetup
      ? { label: "等待首次准备", tone: "warning" }
      : needsQQ
        ? { label: "等待安装 QQ", tone: "warning" }
    : running
      ? { label: "机器人运行中", tone: "ready" }
      : stackState === "partial"
        ? { label: "部分组件需处理", tone: "warning" }
        : { label: "已就绪，等待启动", tone: "neutral" };

  const runAction = async (action: DesktopAction) => {
    if (!desktop) return;
    setActiveAction(action);
    setFeedback(null);
    try {
      const result = await desktop.runAction(action);
      setFeedback(result);
      await onRefresh();
      return result;
    } catch (error) {
      const result = { ok: false, message: error instanceof Error ? error.message : "操作失败" };
      setFeedback(result);
      return result;
    } finally {
      setActiveAction(null);
    }
  };

  const completeFirstSetup = async () => {
    if (!desktop) return;
    setFeedback(null);
    try {
      if (!nativeReady) {
        setActiveAction("install");
        const prepared = await desktop.runAction("install");
        if (!prepared.ok) {
          setFeedback(prepared);
          return;
        }
        if (prepared.code !== "QQ_REQUIRED") {
          setFeedback(prepared);
          return;
        }
      }
      setActiveAction("install-qq");
      const qq = await desktop.runAction("install-qq");
      if (!qq.ok) {
        setFeedback(qq);
        return;
      }
      setActiveAction("start");
      const started = await desktop.runAction("start");
      setFeedback(started);
    } catch (error) {
      setFeedback({ ok: false, message: error instanceof Error ? error.message : "首次准备失败" });
    } finally {
      setActiveAction(null);
      await onRefresh();
    }
  };

  const loadLogs = async (service = logService) => {
    if (!desktop) return;
    setLogsLoading(true);
    setLogService(service);
    try {
      setLogs(await desktop.getLogs(service));
    } finally {
      setLogsLoading(false);
    }
  };

  const revealCredentials = async () => {
    if (!desktop) return;
    if (!credentials) setCredentials(await desktop.getCredentials());
    setCredentialsVisible((visible) => !visible);
  };

  const updatePreference = async (next: Partial<DesktopPreferences>) => {
    if (!desktop) return;
    setPreferences(await desktop.setPreferences(next));
    await onRefresh();
  };

  const serviceState = (id: "astrbot" | "napcat") => {
    const nativeService = runtime?.services.find((service) => service.id === id);
    const probe = status.services.find((service) => service.id === id);
    return {
      running: nativeService?.running ?? false,
      installed: nativeService?.installed ?? false,
      detail: nativeService?.status ?? probe?.detail ?? "尚未准备",
      version: nativeService?.version,
      probe: probe?.state ?? "waiting" as const,
    };
  };

  return (
    <div className="view-enter runtime-view">
      <section className="page-heading runtime-heading">
        <div>
          <span className="eyebrow">DESKTOP CONTROL</span>
          <div className="runtime-title-line">
            <h1>运行控制</h1>
            <span className={`runtime-state state-${stateCopy.tone}`}><span />{stateCopy.label}</span>
          </div>
          <p>Windows 本机直接运行 AstrBot、NapCat 和 QQ。无需 Docker，也无需用户安装 Python 或输入命令。</p>
        </div>
        <button className="button button-secondary" type="button" onClick={onRefresh} disabled={checking || busy}>
          <RefreshCw size={15} className={checking ? "spin" : ""} />
          刷新状态
        </button>
      </section>

      {!supported && (
        <div className="desktop-alert">
          <CircleAlert size={18} />
          <div><strong>{runtime?.message ?? "当前系统不受支持"}</strong><p>请在 64 位 Windows 10 或 Windows 11 上安装此版本。</p></div>
        </div>
      )}

      {(needsSetup || needsQQ) && supported && (
        <div className="desktop-alert setup-alert">
          {needsSetup ? <Download size={18} /> : <MessageCircle size={18} />}
          <div>
            <strong>{needsSetup ? "首次使用，一键完成本机准备" : "基础组件已就绪，还差 Windows QQ"}</strong>
            <p>{needsSetup ? "软件会把独立运行环境、AstrBot 和 NapCat 放入安装时选择的位置，不修改系统 Python。" : "点击后下载 QQ 官方安装程序；完成安装后会自动启动机器人。"}</p>
          </div>
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void completeFirstSetup()}>
            {activeAction ? <RefreshCw size={15} className="spin" /> : <Power size={15} />}
            {activeAction === "install" ? "准备组件中" : activeAction === "install-qq" ? "等待安装 QQ" : activeAction === "start" ? "正在启动" : needsSetup ? "一键完成首次准备" : "安装 QQ 并启动"}
          </button>
        </div>
      )}

      {progressActive && progress && (
        <div className="install-progress" role="status" aria-live="polite">
          <div><span>{progress.detail}</span><strong>{Math.round(progress.percent)}%</strong></div>
          <div className="install-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} /></div>
        </div>
      )}

      <section className="runtime-actions" aria-label="运行操作">
        <button className="runtime-action primary-action" type="button" disabled={unavailable || running || busy} onClick={() => void runAction("start")}>
          <Power size={21} /><span><strong>{activeAction === "start" ? "正在启动" : "启动机器人"}</strong><small>AstrBot + NapCat + QQ</small></span>
        </button>
        <button className="runtime-action" type="button" disabled={!nativeReady || stackState === "stopped" || busy} onClick={() => void runAction("stop")}>
          <Square size={18} /><span><strong>{activeAction === "stop" ? "正在停止" : "停止"}</strong><small>保留所有数据</small></span>
        </button>
        <button className="runtime-action" type="button" disabled={unavailable || stackState === "stopped" || busy} onClick={() => void runAction("restart")}>
          <RotateCcw size={18} /><span><strong>{activeAction === "restart" ? "正在重启" : "重启"}</strong><small>重新加载配置</small></span>
        </button>
      </section>

      {feedback && (
        <div className={`action-feedback ${feedback.ok ? "feedback-ok" : "feedback-error"}`}>
          {feedback.ok ? <Check size={15} /> : <CircleAlert size={15} />}
          <span>{feedback.message}</span>
          {feedback.code === "QQ_DOWNLOAD_FAILED" && <button className="text-link" type="button" onClick={() => void desktop?.openQQDownload()}>打开 QQ 官网</button>}
        </div>
      )}

      {compatibility && (
        <section className={`compatibility-center compatibility-${compatibility.overall}`} aria-label="组件兼容性、升级与回滚中心">
          <div className="compatibility-heading">
            <div className="compatibility-mark"><ShieldCheck size={20} /></div>
            <div>
              <div className="compatibility-title-line">
                <strong>组件兼容中心</strong>
                <span>{compatibility.channel.toUpperCase()}</span>
              </div>
              <p>{compatibility.message} · 策略 {compatibility.policyVersion} · 验证于 {compatibility.testedAt}</p>
            </div>
            <span className={`compatibility-overall overall-${compatibility.overall}`}>
              {compatibility.overall === "compatible" ? "兼容" : compatibility.overall === "update-available" ? "可升级" : compatibility.overall === "unknown" ? "待确认" : "未就绪"}
            </span>
          </div>

          <div className="compatibility-components">
            {compatibility.components.map((component) => (
              <div className="compatibility-component" key={component.id}>
                <div><strong>{component.label}</strong><small>{component.id === "qq" ? "协议运行环境" : "受控组件"}</small></div>
                <div><span>当前</span><code>{component.installedVersion ?? "未识别"}</code></div>
                <div><span>稳定策略</span><code>{component.targetVersion}</code></div>
                <span className={`compatibility-status status-${component.status}`}>
                  {component.status === "compatible" ? "已匹配" : component.status === "update-available" ? "需调整" : component.status === "unknown" ? "未知" : "未安装"}
                </span>
              </div>
            ))}
          </div>

          <div className="compatibility-footer">
            <div className="snapshot-summary">
              <History size={16} />
              <div>
                <strong>{compatibility.snapshot.available ? "上一可用快照已保留" : "尚无回滚快照"}</strong>
                <small>
                  {compatibility.snapshot.createdAt
                    ? `${new Date(compatibility.snapshot.createdAt).toLocaleString("zh-CN", { hour12: false })} · ${[compatibility.snapshot.versions.astrbot, compatibility.snapshot.versions.napcat].filter(Boolean).join(" / ") || "版本未记录"}`
                    : "首次升级或兼容修复前会自动创建"}
                </small>
              </div>
            </div>
            <div className="compatibility-actions">
              <button type="button" disabled={!nativeReady || busy || !compatibilityUpdateAvailable} onClick={() => void runAction("update")}>
                <Download size={15} />{activeAction === "update" ? "正在升级" : "升级到稳定组合"}
              </button>
              <button type="button" disabled={!nativeReady || busy} onClick={() => void runAction("repair")}>
                <Wrench size={15} />{activeAction === "repair" ? "正在修复" : "兼容修复"}
              </button>
              <button className="rollback-action" type="button" disabled={!compatibility.snapshot.available || busy} onClick={() => void runAction("rollback")}>
                <History size={15} />{activeAction === "rollback" ? "正在回滚" : "回滚上一版本"}
              </button>
            </div>
          </div>
          {compatibility.lastOperation && (
            <div className={`compatibility-last-operation operation-${compatibility.lastOperation.status}`}>
              <span>最近操作</span><p>{compatibility.lastOperation.message}</p><time>{new Date(compatibility.lastOperation.at).toLocaleString("zh-CN", { hour12: false })}</time>
            </div>
          )}
        </section>
      )}

      <div className="runtime-grid">
        <section className="component-control">
          <div className="section-label"><span>组件</span><span>运行状态与完整设置</span></div>
          {(["napcat", "astrbot"] as const).map((id) => {
            const service = serviceState(id);
            return (
              <div className="component-row" key={id}>
                <div className={`component-icon ${service.running ? "component-running" : ""}`}>{id === "napcat" ? <Bot size={19} /> : <Server size={19} />}</div>
                <div className="component-copy"><strong>{id === "napcat" ? "NapCat" : "AstrBot"}</strong><span>{service.version ? `${service.version} · ` : ""}{id === "napcat" ? "QQ 登录与 OneBot 网络" : "模型、机器人、知识库与插件"}</span></div>
                <StatusPill state={service.probe} detail />
                <span className="component-detail">{service.detail}</span>
                <ServiceOpenButton panel={id} href={id === "napcat" ? config.napcatUrl : config.astrbotUrl} disabled={!service.running}>打开完整设置</ServiceOpenButton>
              </div>
            );
          })}
        </section>

        <aside className="desktop-tools">
          <div className="section-label"><span>本机工具</span><span>凭据与数据</span></div>
          <button type="button" onClick={() => void revealCredentials()}><KeyRound size={17} /><span><strong>登录凭据</strong><small>{credentialsVisible ? "点击隐藏" : "查看本机生成的密码"}</small></span>{credentialsVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          {credentialsVisible && credentials && (
            <div className="credential-list">
              <div><span>AstrBot 用户名</span><code>{credentials.astrbotUsername}</code><CopyButton value={credentials.astrbotUsername} /></div>
              <div><span>AstrBot 密码</span><code>{credentials.astrbotPassword}</code><CopyButton value={credentials.astrbotPassword} /></div>
              <div><span>NapCat Token</span><code>{credentials.napcatToken}</code><CopyButton value={credentials.napcatToken} /></div>
            </div>
          )}
          <button type="button" onClick={() => void desktop?.openDataFolder()}><FolderOpen size={17} /><span><strong>数据目录</strong><small>{runtime?.runtimeDir ?? "初始化中"}</small></span><ExternalLink size={16} /></button>
          <div className="preference-group">
            <div className="section-label"><span>后台运行</span><span>托盘与自动恢复</span></div>
            <PreferenceToggle
              label="开机启动控制台"
              detail="登录 Windows 后在托盘运行"
              checked={preferences.launchAtLogin}
              onChange={(checked) => void updatePreference({ launchAtLogin: checked })}
            />
            <PreferenceToggle
              label="开机后启动机器人"
              detail="自动启动 AstrBot、NapCat 与 QQ"
              checked={preferences.startBotAtLogin}
              disabled={!preferences.launchAtLogin}
              onChange={(checked) => void updatePreference({ startBotAtLogin: checked })}
            />
            <PreferenceToggle
              label="掉线自动恢复"
              detail="确认异常后自动重启组件"
              checked={preferences.autoRecovery}
              onChange={(checked) => void updatePreference({ autoRecovery: checked })}
            />
          </div>
        </aside>
      </div>

      <section className="log-console">
        <div className="log-toolbar">
          <div><ScrollText size={16} /><span>最近日志</span></div>
          <div className="log-tabs">
            <button className={logService === "astrbot" ? "active" : ""} type="button" onClick={() => void loadLogs("astrbot")}>AstrBot</button>
            <button className={logService === "napcat" ? "active" : ""} type="button" onClick={() => void loadLogs("napcat")}>NapCat</button>
          </div>
          <button className="copy-button" type="button" onClick={() => void loadLogs()} disabled={logsLoading || !nativeReady}><RefreshCw size={14} className={logsLoading ? "spin" : ""} />刷新日志</button>
        </div>
        <pre>{logs}</pre>
      </section>
    </div>
  );
}

function DiagnosticsView({ status, config, onRefresh }: { status: StackStatus; config: PublicConfig; onRefresh: () => Promise<void> | void }) {
  const desktop = window.rosemewbotDesktop;
  const [report, setReport] = useState<DesktopDiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const diagnose = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    try {
      setReport(await desktop.runDiagnostics());
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    void diagnose();
  }, [diagnose, status.checkedAt]);

  const runDiagnosticAction = async (action: DesktopDiagnosticAction) => {
    if (!desktop) return;
    setFeedback(null);
    if (action === "open-astrbot" || action === "open-napcat") {
      await desktop.openPanel(action === "open-astrbot" ? "astrbot" : "napcat");
      return;
    }
    const result = await desktop.runAction(action);
    setFeedback(result);
    await onRefresh();
    await diagnose();
  };

  const uninstallApp = async () => {
    if (!desktop) return;
    setUninstalling(true);
    setFeedback(null);
    try {
      const result = await desktop.uninstallApp();
      if (result.code === "CANCELLED") {
        setUninstalling(false);
        return;
      }
      setFeedback(result);
      if (!result.ok) setUninstalling(false);
    } catch (error) {
      setFeedback({ ok: false, message: error instanceof Error ? error.message : "无法启动完全卸载" });
      setUninstalling(false);
    }
  };

  const passed = report?.items.filter((item) => item.severity === "pass").length ?? 0;
  const attention = report?.items.filter((item) => item.severity !== "pass").length ?? 0;

  return (
    <div className="view-enter">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">SMART DIAGNOSTICS</span>
          <h1>智能诊断</h1>
          <p>检查组件、QQ 登录、真实 OneBot 连接、模型配置、端口与磁盘空间，并给出可执行的处理动作。</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => void diagnose()} disabled={loading || uninstalling || !desktop}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          {loading ? "正在诊断" : "重新诊断"}
        </button>
      </section>

      <div className={`diagnostic-summary summary-${report?.overall ?? "attention"}`}>
        <div className="diagnostic-summary-icon">{report?.overall === "healthy" ? <BadgeCheck size={22} /> : <CircleAlert size={22} />}</div>
        <div><strong>{report?.summary ?? (desktop ? "正在读取本机状态…" : "智能诊断仅在 Windows 桌面版提供。")}</strong><span>{report ? `${passed} 项通过 · ${attention} 项需处理 · ${new Date(report.checkedAt).toLocaleTimeString()}` : ""}</span></div>
      </div>

      {feedback && <div className={`action-feedback ${feedback.ok ? "feedback-ok" : "feedback-error"}`}>{feedback.ok ? <Check size={15} /> : <CircleAlert size={15} />}<span>{feedback.message}</span></div>}

      <div className="diagnostic-layout">
        <section className="diagnostic-results" aria-label="诊断结果">
          {report?.items.map((item) => (
            <div className={`diagnostic-result result-${item.severity}`} key={item.id}>
              <div className="diagnostic-result-state">{item.severity === "pass" ? <Check size={16} /> : <CircleAlert size={16} />}</div>
              <div className="diagnostic-result-copy">
                <div><strong>{item.title}</strong><span>{item.severity === "pass" ? "通过" : item.severity === "warning" ? "待完成" : "需处理"}</span></div>
                <p>{item.detail}</p>
                {item.suggestion && <small>{item.suggestion}</small>}
              </div>
              {item.action && <button className="button button-secondary" type="button" onClick={() => void runDiagnosticAction(item.action!)}>{item.actionLabel ?? "处理"}<ChevronRight size={15} /></button>}
            </div>
          ))}
          {!report && <div className="empty-state">等待第一次智能诊断…</div>}
        </section>

        <aside className="quick-reference">
          <div className="quick-reference-title"><Settings2 size={16} />本机入口</div>
          <dl>
            <div><dt>AstrBot</dt><dd><PanelTextLink panel="astrbot" href={config.astrbotUrl} /></dd></div>
            <div><dt>NapCat</dt><dd><PanelTextLink panel="napcat" href={config.napcatUrl} /></dd></div>
            <div><dt>反向 WS</dt><dd><code>{config.onebotUrl}</code></dd></div>
          </dl>
          <div className="reference-divider" />
          <p>系统每 15 秒检查一次运行状态。仅在机器人原本应当运行且确认异常后，自动恢复才会重启组件。</p>
          <div className="command-line compact"><code>本机端口 · 自动验收 · 安全恢复</code></div>
          <div className="danger-zone">
            <div className="danger-zone-title"><ShieldAlert size={16} /><span><strong>危险操作</strong><small>程序与本地数据不可恢复</small></span></div>
            <p>停止机器人并删除 Rosemewbot、全部组件、配置、凭据、缓存与日志；不会卸载腾讯 QQ。</p>
            <button className="button button-danger" type="button" disabled={!desktop || uninstalling} onClick={() => void uninstallApp()}>
              <Trash2 size={15} />{uninstalling ? "正在启动卸载" : "一键完全卸载"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function App() {
  const desktop = Boolean(window.rosemewbotDesktop);
  const [view, setView] = useState<ViewId>(desktop ? "runtime" : "onboarding");
  const [status, setStatus] = useState<StackStatus>(emptyStatus);
  const [config, setConfig] = useState<PublicConfig>(fallbackConfig);
  const [runtime, setRuntime] = useState<DesktopRuntimeState | null>(null);
  const [acceptance, setAcceptance] = useState<DesktopAcceptanceState | null>(desktop ? emptyAcceptance : null);
  const [checking, setChecking] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const { theme, setTheme } = useThemePreference();
  const { completed, toggle } = usePersistentSteps();

  useEffect(() => {
    const unsubscribe = window.rosemewbotDesktop?.onRuntimeProgress((progress: DesktopInstallProgress) => {
      setRuntime((current) => current ? { ...current, busy: true, installProgress: progress } : current);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.rosemewbotDesktop?.onPanelRequested((panel) => {
      setView(panel);
      setMobileNav(false);
    });
    return () => unsubscribe?.();
  }, []);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      if (window.rosemewbotDesktop) {
        const next = await window.rosemewbotDesktop.getStatus();
        setStatus(next.stack);
        setRuntime(next.runtime);
        setAcceptance(next.acceptance);
        return;
      }
      const response = await fetch("/api/status", { cache: "no-store" });
      if (response.ok) setStatus(await response.json() as StackStatus);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const configRequest = window.rosemewbotDesktop
      ? window.rosemewbotDesktop.getConfig()
      : fetch("/api/config", { cache: "no-store" }).then((response) => response.json() as Promise<PublicConfig>);
    configRequest
      .then((next: PublicConfig) => {
        const useCurrentHost = (value: string) => {
          if (window.rosemewbotDesktop) return value.replace(/\/$/, "");
          const url = new URL(value);
          if (["localhost", "127.0.0.1"].includes(url.hostname) && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
            url.hostname = window.location.hostname;
          }
          return url.toString().replace(/\/$/, "");
        };
        setConfig({
          ...next,
          astrbotUrl: useCurrentHost(next.astrbotUrl),
          napcatUrl: useCurrentHost(next.napcatUrl),
        });
      })
      .catch(() => setConfig(fallbackConfig));
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="app-shell">
      <Sidebar view={view} onViewChange={setView} desktop={desktop} theme={theme} onThemeChange={setTheme} />
      {mobileNav && <div className="mobile-sidebar-backdrop" onClick={() => setMobileNav(false)}><div onClick={(event) => event.stopPropagation()}><Sidebar view={view} onViewChange={setView} desktop={desktop} theme={theme} onThemeChange={setTheme} onClose={() => setMobileNav(false)} /></div></div>}
      <main>
        <Topbar status={status} acceptance={acceptance} checking={checking} onRefresh={refresh} onMenu={() => setMobileNav(true)} />
        <div className={`content-wrap ${view === "napcat" || view === "astrbot" ? "embedded-content-wrap" : ""}`}>
          {view === "runtime" && <RuntimeView runtime={runtime} status={status} config={config} checking={checking} onRefresh={refresh} />}
          {view === "napcat" && <EmbeddedPanelWorkspace panel="napcat" runtime={runtime} suspended={mobileNav} />}
          {view === "astrbot" && <EmbeddedPanelWorkspace panel="astrbot" runtime={runtime} suspended={mobileNav} />}
          {view === "onboarding" && <Onboarding config={config} status={status} acceptance={acceptance} checking={checking} onRefresh={refresh} completed={completed} onToggle={toggle} />}
          {view === "status" && <StatusView status={status} config={config} acceptance={acceptance} checking={checking} onRefresh={refresh} />}
          {view === "diagnostics" && <DiagnosticsView status={status} config={config} onRefresh={refresh} />}
        </div>
      </main>
    </div>
  );
}
