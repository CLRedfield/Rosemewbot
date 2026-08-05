import path from "node:path";

export const fullUninstallArguments = [
  "/S",
  "--delete-app-data",
  "--delete-rosemewbot-data",
] as const;

export function buildFullUninstallPlan(executablePath: string) {
  return {
    uninstallerPath: path.join(path.dirname(executablePath), "Uninstall Rosemewbot.exe"),
    arguments: [...fullUninstallArguments],
  };
}
