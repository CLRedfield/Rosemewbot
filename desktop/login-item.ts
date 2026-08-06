export const WINDOWS_LOGIN_ITEM_NAME = "com.rosemewbot.desktop";
export const WINDOWS_LOGIN_ITEM_ARGS = ["--background"] as const;

interface LoginItemSettings {
  openAtLogin?: boolean;
  enabled?: boolean;
  name?: string;
  path?: string;
  args?: string[];
}

interface LoginItemSnapshot {
  openAtLogin: boolean;
  executableWillLaunchAtLogin?: boolean;
}

export interface LoginItemApp {
  isPackaged: boolean;
  setLoginItemSettings(settings: LoginItemSettings): void;
  getLoginItemSettings(options?: Pick<LoginItemSettings, "path" | "args">): LoginItemSnapshot;
}

export interface LoginItemSyncResult {
  supported: boolean;
  requested: boolean;
  registered: boolean;
  enabled: boolean;
  matches: boolean;
  repaired: boolean;
}

export function windowsLoginItemSettings(openAtLogin: boolean, executablePath: string): LoginItemSettings {
  return {
    openAtLogin,
    enabled: openAtLogin,
    name: WINDOWS_LOGIN_ITEM_NAME,
    path: executablePath,
    args: [...WINDOWS_LOGIN_ITEM_ARGS],
  };
}

function inspectLoginItem(app: LoginItemApp, requested: boolean, executablePath: string): LoginItemSyncResult {
  const settings = app.getLoginItemSettings({
    path: executablePath,
    args: [...WINDOWS_LOGIN_ITEM_ARGS],
  });
  const registered = settings.openAtLogin;
  const enabled = settings.executableWillLaunchAtLogin ?? registered;
  return {
    supported: true,
    requested,
    registered,
    enabled,
    matches: requested ? registered && enabled : !registered,
    repaired: false,
  };
}

export function syncWindowsLoginItem(
  app: LoginItemApp,
  requested: boolean,
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): LoginItemSyncResult {
  if (!app.isPackaged || platform !== "win32") {
    return {
      supported: false,
      requested,
      registered: false,
      enabled: false,
      matches: true,
      repaired: false,
    };
  }

  app.setLoginItemSettings(windowsLoginItemSettings(requested, executablePath));
  let result = inspectLoginItem(app, requested, executablePath);

  // Windows can retain a stale StartupApproved entry even after the Run value
  // is rewritten. Recreate both records once when enabling, or retry removal
  // once when disabling, then verify the effective state again.
  if (!result.matches) {
    if (requested) app.setLoginItemSettings(windowsLoginItemSettings(false, executablePath));
    app.setLoginItemSettings(windowsLoginItemSettings(requested, executablePath));
    result = { ...inspectLoginItem(app, requested, executablePath), repaired: true };
  }

  return result;
}
