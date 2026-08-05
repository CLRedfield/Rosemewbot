import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildFullUninstallPlan, fullUninstallArguments } from "../desktop/uninstall";

describe("full uninstall plan", () => {
  it("uses the installed uninstaller and destructive cleanup flags", () => {
    const plan = buildFullUninstallPlan("C:\\Rosemewbot\\Rosemewbot.exe");

    expect(plan.uninstallerPath).toBe(path.join("C:\\Rosemewbot", "Uninstall Rosemewbot.exe"));
    expect(plan.arguments).toEqual([
      "/S",
      "--delete-app-data",
      "--delete-rosemewbot-data",
    ]);
    expect(fullUninstallArguments).toHaveLength(3);
  });
});
