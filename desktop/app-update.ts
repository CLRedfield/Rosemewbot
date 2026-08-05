export const APP_RELEASE_API = "https://api.github.com/repos/CLRedfield/Rosemewbot/releases/latest";
export const APP_RELEASE_PAGE = "https://github.com/CLRedfield/Rosemewbot/releases/latest";

export interface GitHubAppRelease {
  tag_name: string;
  html_url?: string;
  published_at?: string | null;
}

export interface AppUpdateResult {
  status: "current" | "available" | "error";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  checkedAt: string;
  message: string;
}

function versionParts(value: string) {
  const [core, prerelease = ""] = value.trim().replace(/^v/i, "").split("-", 2);
  const numbers = core.split(".").map((part) => Number.parseInt(part, 10));
  return {
    numbers: numbers.map((part) => Number.isFinite(part) ? part : 0),
    prerelease,
  };
}

export function normalizeAppVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

export function compareAppVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

export function createAppUpdateResult(currentVersion: string, release: GitHubAppRelease, checkedAt = new Date().toISOString()): AppUpdateResult {
  const latestVersion = normalizeAppVersion(release.tag_name);
  if (!latestVersion) throw new Error("发布版本信息为空");
  const available = compareAppVersions(latestVersion, currentVersion) > 0;
  const releaseUrl = release.html_url?.startsWith("https://github.com/CLRedfield/Rosemewbot/releases/")
    ? release.html_url
    : APP_RELEASE_PAGE;
  return {
    status: available ? "available" : "current",
    currentVersion,
    latestVersion,
    releaseUrl,
    publishedAt: release.published_at ?? null,
    checkedAt,
    message: available
      ? `发现 Rosemewbot v${latestVersion}，可前往发布页下载安装。`
      : `当前已是最新正式版 v${currentVersion}。`,
  };
}

export function createAppUpdateError(currentVersion: string, detail: string, checkedAt = new Date().toISOString()): AppUpdateResult {
  return {
    status: "error",
    currentVersion,
    latestVersion: null,
    releaseUrl: APP_RELEASE_PAGE,
    publishedAt: null,
    checkedAt,
    message: `暂时无法检查更新：${detail}`,
  };
}
