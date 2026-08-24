import { describe, expect, it } from "vitest";

import {
  APP_RELEASE_PAGE,
  compareAppVersions,
  createAppUpdateResult,
} from "../desktop/app-update";

describe("Rosemewbot application update checks", () => {
  it("compares release versions numerically", () => {
    expect(compareAppVersions("0.6.2", "0.6.1")).toBe(1);
    expect(compareAppVersions("0.5.10", "0.5.9")).toBe(1);
    expect(compareAppVersions("v0.5.4", "0.5.4")).toBe(0);
    expect(compareAppVersions("0.5.4-beta.1", "0.5.4")).toBe(-1);
  });

  it("reports a newer official release", () => {
    expect(createAppUpdateResult("0.5.4", {
      tag_name: "v0.6.2",
      html_url: "https://github.com/CLRedfield/Rosemewbot/releases/tag/v0.6.2",
      published_at: "2026-08-06T00:00:00.000Z",
    }, "2026-08-06T00:01:00.000Z")).toMatchObject({
      status: "available",
      currentVersion: "0.5.4",
      latestVersion: "0.6.2",
    });
  });

  it("falls back to the trusted releases page", () => {
    expect(createAppUpdateResult("0.5.4", {
      tag_name: "v0.5.4",
      html_url: "https://example.com/untrusted-download.exe",
    }).releaseUrl).toBe(APP_RELEASE_PAGE);
  });
});
