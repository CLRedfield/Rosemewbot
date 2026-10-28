export interface StartupPreferences {
  launchAtLogin: boolean;
  startBotAtLogin: boolean;
  startBotOnLaunch: boolean;
  autoLoginSnowLuma: boolean;
  autoStartQQ: boolean;
  autoConnectQQ: boolean;
  autoRecovery: boolean;
  autoLoginAccount: string | null;
}

export const defaultStartupPreferences: StartupPreferences = {
  launchAtLogin: false,
  startBotAtLogin: false,
  startBotOnLaunch: false,
  // Preserve the existing automatic panel login / account attachment on upgrade.
  autoLoginSnowLuma: true,
  autoStartQQ: true,
  autoConnectQQ: true,
  autoRecovery: true,
  autoLoginAccount: null,
};

export const booleanPreferenceKeys = [
  "launchAtLogin", "startBotAtLogin", "startBotOnLaunch", "autoLoginSnowLuma",
  "autoStartQQ", "autoConnectQQ", "autoRecovery",
] as const;

export function shouldStartBotOnLaunch(preferences: StartupPreferences, background: boolean) {
  return background ? preferences.startBotAtLogin : preferences.startBotOnLaunch;
}
