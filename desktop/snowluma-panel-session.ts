interface PanelContents {
  isDestroyed(): boolean;
  getURL(): string;
  executeJavaScript(code: string): Promise<unknown>;
  reload(): void;
}

/** Sync only our local panel. Never put credentials in a URL or the renderer's preferences. */
export class SnowLumaPanelSession {
  private readonly pending = new WeakMap<PanelContents, Promise<boolean>>();

  constructor(private readonly options: {
    origin: string;
    enabled(): Promise<boolean>;
    token(): Promise<string>;
  }) {}

  sync(contents: PanelContents): Promise<boolean> {
    const current = this.pending.get(contents);
    if (current) return current;
    const work = this.syncOnce(contents).catch(() => false).finally(() => this.pending.delete(contents));
    this.pending.set(contents, work);
    return work;
  }

  private isLocal(contents: PanelContents) {
    return !contents.isDestroyed() && new URL(contents.getURL()).origin === this.options.origin;
  }

  private async syncOnce(contents: PanelContents) {
    if (!this.isLocal(contents)) return false;
    const enabled = await this.options.enabled();
    const token = enabled ? await this.options.token() : null;
    // Settings can change or the page can navigate while authentication is pending.
    if (!this.isLocal(contents) || enabled !== await this.options.enabled()) return false;
    const changed = await contents.executeJavaScript(`(() => {
      if (location.origin !== ${JSON.stringify(this.options.origin)}) return false;
      const key = "snowluma_token";
      const owner = "rosemewbot_auto_login";
      const token = ${JSON.stringify(token)};
      if (token === null) {
        if (localStorage.getItem(owner) !== "1") return false;
        localStorage.removeItem(owner);
        localStorage.removeItem(key);
        return true;
      }
      const changed = localStorage.getItem(key) !== token;
      localStorage.setItem(key, token);
      localStorage.setItem(owner, "1");
      return changed;
    })()`);
    if (changed && this.isLocal(contents)) {
      contents.reload();
      return true;
    }
    return false;
  }
}
