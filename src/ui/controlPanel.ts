import type { RosettaController, RosettaUiSnapshot } from "../app/controller";
import type { ManualSearchEntry, SyncFidelity } from "../types";
import { injectStyles } from "./styles";

const BUTTON_CLASS = "rosetta-playbar-button";
const MODAL_CLASS = "rosetta-modal";
const ROSETTA_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5c0-1.4 1.1-2.5 2.5-2.5H20v13H6.5A2.5 2.5 0 0 0 4 19.5z"/><path d="M4 19.5C4 20.9 5.1 22 6.5 22H20v-5"/><path d="M8 8h8M8 11h6"/></svg>`;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fidelityText(fidelity: SyncFidelity | undefined): string {
  switch (fidelity) {
    case "word":
      return "逐字";
    case "line":
      return "逐行";
    case "unsynced":
      return "非同步";
    case "original-only":
      return "仅原文";
    default:
      return "未加载";
  }
}

function providerName(providerId: string): string {
  switch (providerId) {
    case "netease":
      return "网易云音乐";
    case "qq":
      return "QQ音乐";
    case "musixmatch":
      return "Musixmatch";
    case "lyricstranslate":
      return "LyricsTranslate";
    case "web":
      return "网页双语译文";
    case "lrclib":
      return "LRCLIB";
    case "spotify":
      return "Spotify";
    case "local":
      return "本地导入";
    default:
      return providerId;
  }
}

export class ControlPanel {
  private snapshot?: RosettaUiSnapshot;
  private unsubscribe?: () => void;
  private playbarButton?: HTMLButtonElement;
  private placementTimer?: number;
  private modal?: HTMLElement;
  private modalBody?: HTMLElement;
  private activeTab: "settings" | "search" | "import" | "about" = "settings";
  private manualResults: ManualSearchEntry[] = [];
  private manualSearching = false;
  private clearArmed = false;

  constructor(private readonly controller: RosettaController) {
    injectStyles();
    this.unsubscribe = controller.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.updateButton();
    });
    this.playbarButton = this.createPlaybarButton();
    this.placementTimer = window.setInterval(() => this.placeButton(), 2_000);
    this.placeButton();
  }

  dispose(): void {
    this.unsubscribe?.();
    if (this.placementTimer) window.clearInterval(this.placementTimer);
    this.placementTimer = undefined;
    this.playbarButton?.remove();
    this.closeModal();
  }

  openModal(
    tab: "settings" | "search" | "import" | "about" = "settings",
  ): void {
    this.activeTab = tab;
    this.closeModal();
    const backdrop = element("div", "rosetta-modal-backdrop");
    backdrop.setAttribute("role", "presentation");
    const modal = element("section", MODAL_CLASS);
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Spotify Rosetta 设置");

    const header = element("header", "rosetta-modal-header");
    header.append(element("h2", "rosetta-modal-title", "Spotify Rosetta"));
    const close = element("button", "rosetta-modal-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => this.closeModal());
    header.appendChild(close);

    const tabs = element("nav", "rosetta-tabs");
    tabs.setAttribute("aria-label", "Rosetta 页面");
    const definitions: Array<
      ["settings" | "search" | "import" | "about", string]
    > = [
      ["settings", "设置"],
      ["search", "手动选源"],
      ["import", "本地译文"],
      ["about", "关于"],
    ];
    for (const [id, label] of definitions) {
      const tab = element("button", "rosetta-tab", label);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(id === this.activeTab));
      tab.addEventListener("click", () => {
        this.activeTab = id;
        for (const item of tabs.querySelectorAll<HTMLElement>("button")) {
          item.setAttribute(
            "aria-selected",
            String(item.textContent === label),
          );
        }
        this.renderTab();
      });
      tabs.appendChild(tab);
    }

    const body = element("div", "rosetta-modal-body");
    this.modalBody = body;
    modal.append(header, tabs, body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    this.modal = backdrop;

    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) this.closeModal();
    });
    document.addEventListener("keydown", this.handleModalKeyDown, true);
    this.renderTab();
  }

  private createPlaybarButton(): HTMLButtonElement | undefined {
    const Button = window.Spicetify?.Playbar?.Button;
    if (Button) {
      try {
        const button = new Button(
          "Spotify Rosetta：左键开关歌词增强，右键设置",
          ROSETTA_ICON,
          () => void this.toggleEnabled(),
          false,
          this.snapshot?.enabled ?? true,
          true,
        );
        button.register();
        const element = button.element;
        if (element) {
          element.classList.add(BUTTON_CLASS);
          element.addEventListener("contextmenu", this.handleContextMenu);
          return element;
        }
      } catch {
        // Fall through to a native button when the Spicetify API changes.
      }
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.title = "Spotify Rosetta：左键开关歌词增强，右键设置";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = ROSETTA_ICON;
    button.addEventListener("click", () => void this.toggleEnabled());
    button.addEventListener("contextmenu", this.handleContextMenu);
    return button;
  }

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.openModal("settings");
  };

  private async toggleEnabled(): Promise<void> {
    const enabled = this.snapshot?.enabled ?? true;
    await this.controller.updateSettings({ enabled: !enabled });
  }

  private updateButton(): void {
    if (!this.playbarButton) return;
    this.playbarButton.classList.toggle(
      "rosetta-active",
      this.snapshot?.enabled ?? false,
    );
    this.playbarButton.classList.toggle(
      "rosetta-loading",
      this.snapshot?.loading ?? false,
    );
    this.playbarButton.title = this.snapshot?.statusText
      ? `Spotify Rosetta · ${this.snapshot.statusText}`
      : "Spotify Rosetta";
    if (this.modal && this.activeTab === "settings") {
      const status = this.modal.querySelector<HTMLElement>(".rosetta-live-status");
      if (status) status.textContent = this.snapshot?.statusText ?? "";
    }
  }

  private placeButton(): void {
    if (!this.playbarButton?.isConnected) {
      const button = this.createPlaybarButton();
      if (button) this.playbarButton = button;
    }
    if (!this.playbarButton || this.playbarButton.isConnected) return;
    const bar = document.querySelector<HTMLElement>(
      '[data-testid="now-playing-bar"]',
    );
    if (!bar) return;
    const nativeLyricsButton =
      bar.querySelector<HTMLButtonElement>(
        'button[data-testid*="lyric" i]',
      ) ??
      [...bar.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        /lyrics|歌词/i.test(
          `${button.getAttribute("aria-label") ?? ""} ${
            button.getAttribute("title") ?? ""
          }`,
        ),
      );
    if (!nativeLyricsButton?.parentElement) return;
    nativeLyricsButton.parentElement.insertBefore(
      this.playbarButton,
      nativeLyricsButton.nextSibling,
    );
  }

  private handleModalKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeModal();
    }
  };

  private closeModal(): void {
    document.removeEventListener("keydown", this.handleModalKeyDown, true);
    this.modal?.remove();
    this.modal = undefined;
    this.modalBody = undefined;
    this.manualResults = [];
    this.manualSearching = false;
    this.clearArmed = false;
  }

  private renderTab(): void {
    const body = this.modalBody;
    if (!body) return;
    body.replaceChildren();
    if (this.activeTab === "settings") this.renderSettings(body);
    if (this.activeTab === "search") this.renderSearch(body);
    if (this.activeTab === "import") this.renderImport(body);
    if (this.activeTab === "about") this.renderAbout(body);
  }

  private renderSettings(body: HTMLElement): void {
    const settings = this.controller.getSettings();
    const status = element(
      "div",
      "rosetta-note rosetta-live-status",
      this.snapshot?.statusText ?? "",
    );
    body.appendChild(status);

    body.appendChild(element("h3", "rosetta-section-title", "显示"));
    body.appendChild(
      this.switchRow(
        "启用 Rosetta",
        "关闭后移除所有注入内容，Spotify 原生歌词保持原样。",
        settings.enabled,
        (checked) => void this.controller.updateSettings({ enabled: checked }),
      ),
    );
    body.appendChild(
      this.switchRow(
        "显示部分翻译",
        "某个来源只有部分行有译文时，仍显示已匹配的部分。",
        settings.showPartial,
        (checked) =>
          void this.controller.updateSettings({ showPartial: checked }),
      ),
    );
    body.appendChild(
      this.switchRow(
        "显示非同步译文",
        "没有逐行时间轴时，把整段现成译文显示在歌词末尾。",
        settings.showUnsynced,
        (checked) =>
          void this.controller.updateSettings({ showUnsynced: checked }),
      ),
    );
    body.appendChild(
      this.switchRow(
        "译文逐字渐亮",
        "仅当歌词来源带字级时间轴时生效，否则使用 Spotify 原生行高亮。",
        settings.wordHighlight,
        (checked) =>
          void this.controller.updateSettings({ wordHighlight: checked }),
      ),
    );
    body.appendChild(
      this.switchRow(
        "无原生歌词时显示 Now Playing 歌词",
        "Spotify 没有原生歌词区或显示暂无歌词时，在右侧 Now Playing 面板显示现成双语歌词；若歌曲本身没有中文译文，则显示同源现成原文。",
        settings.showNowPlayingFallback,
        (checked) =>
          void this.controller.updateSettings({
            showNowPlayingFallback: checked,
          }),
      ),
    );

    body.appendChild(element("h3", "rosetta-section-title", "歌词来源"));
    const providerRows: Array<
      [keyof typeof settings.providers, string, string]
    > = [
      ["netease", "网易云音乐", "优先使用 lrc、tlyric 和 klyric。"],
      ["qq", "QQ音乐", "使用公开歌词接口中的 orig 与 ts。"],
      ["musixmatch", "Musixmatch", "使用现成 crowd translation。"],
      [
        "lyricstranslate",
        "LyricsTranslate",
        "搜索非大陆曲库中已经存在的人工中文译文。",
      ],
      [
        "web",
        "网页双语译文",
        "读取已收录的人工双语文章，并按 Spotify 原文复核。",
      ],
      ["lrclib", "LRCLIB", "只补原文，不会生成译文。"],
      ["spotify", "Spotify 原生", "仅作为原生歌词和空歌词回退基准。"],
      ["local", "本地导入", "优先显示按 Track ID 保存的现成 LRC 或 JSON 译文。"],
    ];
    for (const [key, label, help] of providerRows) {
      body.appendChild(
        this.switchRow(
          label,
          help,
          settings.providers[key],
          (checked) =>
            void this.controller.updateSettings({
              providers: { [key]: checked },
            }),
        ),
      );
    }

    if (this.snapshot?.diagnostics.length) {
      body.appendChild(element("h3", "rosetta-section-title", "本次查询"));
      for (const diagnostic of this.snapshot.diagnostics) {
        body.appendChild(
          element(
            "div",
            "rosetta-note",
            `${providerName(diagnostic.providerId)}：${diagnostic.status}${
              diagnostic.message ? ` · ${diagnostic.message}` : ""
            }`,
          ),
        );
      }
    }

    const actions = element("div", "rosetta-actions");
    const refresh = element("button", "rosetta-button", "重新查找");
    refresh.type = "button";
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.textContent = "正在查找…";
      try {
        await this.controller.refreshCurrent(true);
        refresh.textContent = "已刷新";
      } finally {
        window.setTimeout(() => {
          refresh.disabled = false;
          refresh.textContent = "重新查找";
        }, 900);
      }
    });
    actions.appendChild(refresh);

    const clear = element("button", "rosetta-button danger", "清空缓存");
    clear.type = "button";
    clear.addEventListener("click", async () => {
      if (!this.clearArmed) {
        this.clearArmed = true;
        clear.textContent = "再次点击确认清空";
        window.setTimeout(() => {
          this.clearArmed = false;
          if (clear.isConnected) clear.textContent = "清空缓存";
        }, 3_500);
        return;
      }
      this.clearArmed = false;
      clear.disabled = true;
      await this.controller.clearCache();
      clear.textContent = "缓存已清空";
    });
    actions.appendChild(clear);
    body.appendChild(actions);
  }

  private switchRow(
    label: string,
    help: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const row = element("label", "rosetta-field-row");
    const copy = element("span", "rosetta-field-copy");
    copy.append(
      element("span", "rosetta-field-label", label),
      element("span", "rosetta-field-help", help),
    );
    const input = element("input", "rosetta-switch");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    row.append(copy, input);
    return row;
  }

  private renderSearch(body: HTMLElement): void {
    const track = this.snapshot?.track;
    body.appendChild(
      element(
        "p",
        "rosetta-note",
        "只查询各平台已经存在的歌词和译文。候选可以来自不同来源，但最终原文和译文始终来自同一个来源。",
      ),
    );
    const grid = element("div", "rosetta-search-grid");
    const title = element("input", "rosetta-input");
    title.type = "text";
    title.placeholder = "歌名";
    title.value = track?.title ?? "";
    const artist = element("input", "rosetta-input");
    artist.type = "text";
    artist.placeholder = "艺人，多个用逗号分隔";
    artist.value = track?.artists.join(", ") ?? "";
    const album = element("input", "rosetta-input");
    album.type = "text";
    album.placeholder = "专辑";
    album.value = track?.album ?? "";
    grid.append(title, artist, album);
    body.appendChild(grid);

    const actions = element("div", "rosetta-actions");
    const search = element("button", "rosetta-button", "搜索现成歌词/译文");
    search.type = "button";
    const results = element("div", "rosetta-search-results");
    const renderResults = () => {
      results.replaceChildren();
      if (this.manualSearching) {
        results.appendChild(
          element("div", "rosetta-note", "正在并行查询歌词来源…"),
        );
        return;
      }
      if (!this.manualResults.length) {
        results.appendChild(
          element("div", "rosetta-note", "尚未找到候选，或还没有开始搜索。"),
        );
        return;
      }
      for (const entry of this.manualResults) {
        const row = element("div", "rosetta-candidate");
        const copy = element("div", "rosetta-candidate-copy");
        const titleNode = element(
          "div",
          "rosetta-candidate-title",
          `${entry.candidate.title} · ${entry.candidate.artists.join(", ")}`,
        );
        const coverage =
          entry.coverage === undefined
            ? "覆盖率未加载"
            : `覆盖率 ${Math.round(entry.coverage * 100)}%`;
        const meta = element(
          "div",
          "rosetta-candidate-meta",
          `${entry.providerLabel} · 匹配 ${Math.round(entry.matchScore * 100)}% · ${coverage} · ${fidelityText(entry.fidelity)}`,
        );
        copy.append(titleNode, meta);
        const use = element("button", "rosetta-button secondary", "使用");
        use.type = "button";
        use.disabled = !entry.result;
        use.addEventListener("click", async () => {
          use.disabled = true;
          use.textContent = "应用中…";
          try {
            await this.controller.applyManualSelection(entry);
            this.closeModal();
          } catch (error) {
            use.disabled = false;
            use.textContent = error instanceof Error ? error.message : "失败";
          }
        });
        row.append(copy, use);
        results.appendChild(row);
      }
    };

    search.addEventListener("click", async () => {
      this.manualSearching = true;
      search.disabled = true;
      this.manualResults = [];
      renderResults();
      try {
        this.manualResults = await this.controller.manualSearch({
          title: title.value,
          artist: artist.value,
          album: album.value,
        });
      } finally {
        this.manualSearching = false;
        search.disabled = false;
        renderResults();
      }
    });
    actions.appendChild(search);
    body.append(actions, results);
    renderResults();
  }

  private renderImport(body: HTMLElement): void {
    const track = this.snapshot?.track;
    body.appendChild(
      element(
        "p",
        "rosetta-note",
        track
          ? `为当前歌曲“${track.title} · ${track.artists.join(", ")}”导入已有的中文译文。内容只保存在本机，不会上传。`
          : "播放一首 Spotify 歌曲后，可为其导入已有的中文译文。",
      ),
    );
    body.appendChild(
      element(
        "p",
        "rosetta-note",
        "支持双语 LRC、纯译文 LRC、逐行 JSON。纯译文 LRC 会按时间轴绑定到 Spotify 原文；没有时间轴时，只有行数一致才会按顺序绑定。",
      ),
    );

    const source = element("input", "rosetta-input");
    source.type = "text";
    source.placeholder = "来源名称或链接，例如 https://lyricstranslate.com/...";
    body.appendChild(source);

    const editor = element("textarea", "rosetta-input rosetta-textarea");
    editor.placeholder =
      "[00:01.00]Original line\n[00:01.00]已有中文译文\n\n或粘贴包含 original/translation 的 JSON";
    editor.rows = 12;
    body.appendChild(editor);

    const fileInput = element("input");
    fileInput.type = "file";
    fileInput.accept = ".lrc,.txt,.json,text/plain,application/json";
    fileInput.hidden = true;
    body.appendChild(fileInput);

    const actions = element("div", "rosetta-actions");
    const chooseFile = element("button", "rosetta-button secondary", "选择文件");
    chooseFile.type = "button";
    chooseFile.addEventListener("click", () => fileInput.click());
    const importButton = element("button", "rosetta-button", "导入并应用");
    importButton.type = "button";
    const importWeb = element(
      "button",
      "rosetta-button secondary",
      "从网页链接提取",
    );
    importWeb.type = "button";
    const status = element("div", "rosetta-note");
    let selectedFileName = "";

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      selectedFileName = file.name;
      editor.value = await file.text();
      if (!source.value.trim()) source.value = file.name;
      status.textContent = `已读取 ${file.name}，点击“导入并应用”生效。`;
    });

    importButton.addEventListener("click", async () => {
      if (!track) {
        status.textContent = "当前没有正在播放的歌曲。";
        return;
      }
      importButton.disabled = true;
      importButton.textContent = "正在导入…";
      status.textContent = "";
      try {
        const result = await this.controller.importLocalTranslation(
          editor.value,
          source.value.trim() || selectedFileName || "本地文件",
        );
        status.textContent = `已导入 ${result.lines.length} 行，译文覆盖率 ${Math.round(
          result.translationCoverage * 100,
        )}%。`;
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "本地译文导入失败。";
      } finally {
        importButton.disabled = false;
        importButton.textContent = "导入并应用";
      }
    });

    importWeb.addEventListener("click", async () => {
      if (!track) {
        status.textContent = "当前没有正在播放的歌曲。";
        return;
      }
      const url = source.value.trim();
      if (!/^https?:\/\//i.test(url)) {
        status.textContent = "请先填写包含人工译文的网页 URL。";
        return;
      }
      importWeb.disabled = true;
      importWeb.textContent = "正在提取…";
      status.textContent = "";
      try {
        const result = await this.controller.importWebTranslation(url);
        status.textContent = `已从网页提取 ${result.lines.length} 行，覆盖率 ${Math.round(
          result.translationCoverage * 100,
        )}%。`;
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "网页译文提取失败。";
      } finally {
        importWeb.disabled = false;
        importWeb.textContent = "从网页链接提取";
      }
    });

    actions.append(chooseFile, importButton, importWeb);
    body.append(actions, status);
  }

  private renderAbout(body: HTMLElement): void {
    const about = element("div", "rosetta-about");
    about.append(
      element(
        "p",
        "rosetta-note",
        "Spotify Rosetta 在 Spotify 原生歌词界面中追加互联网已经存在的译文；Spotify 没有原生歌词时，可显示同源现成原文或双语歌词。它不包含机器翻译、AI 翻译或生成式补译。",
      ),
      element(
        "p",
        "rosetta-note",
        "本机缓存最多保留 500 首歌词结果；手动选择的来源单独保存。向歌词平台发送的只有歌名、艺人、专辑和时长。",
      ),
    );
    const list = element("ul", "rosetta-about-list");
    const entries: Array<[string, string, string]> = [
      ["Spotify", "https://www.spotify.com/", "桌面客户端与原生歌词界面"],
      ["Spicetify", "https://spicetify.app/", "本地扩展运行环境，LGPL-2.1"],
      ["Lyrics Plus", "https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus", "Provider 行为参考，LGPL-2.1"],
      ["ivLyrics", "https://github.com/ivLis-Studio/ivLyrics", "右侧歌词注入行为参考，LGPL-2.1"],
      ["Lyricify-Lyrics-Helper", "https://github.com/WXRIW/Lyricify-Lyrics-Helper", "歌词协议与解析参考，Apache-2.0"],
      ["Lyricify-Lyrics-Helper-Swift", "https://github.com/WXRIW/Lyricify-Lyrics-Helper-Swift", "QQ QRC Modified DES 算法参考，Apache-2.0"],
      ["fflate", "https://github.com/101arrowz/fflate", "QRC zlib 解压，MIT"],
      ["LRCLIB", "https://lrclib.net/", "开放歌词原文来源"],
      ["网易云音乐", "https://music.163.com/", "lrc、tlyric、klyric 现成歌词来源"],
      ["GD Studio Music API", "https://music-api.gdstudio.xyz/", "网易云搜索与歌词的聚合回退服务"],
      ["QQ音乐", "https://y.qq.com/", "orig 与 ts 现成歌词来源"],
      ["Musixmatch", "https://www.musixmatch.com/", "现成 crowd translation 来源"],
      [
        "LyricsTranslate",
        "https://lyricstranslate.com/",
        "非大陆人工中文翻译来源",
      ],
      [
        "Navidrome LyricsTranslate Plugin",
        "https://github.com/Myzel394/navidrome-lyricstranslate-plugin",
        "LyricsTranslate 页面与字幕结构参考，MIT",
      ],
      [
        "蔚藍天空 · PIXNET",
        "https://tonyliu0936.pixnet.net/blog/posts/14217066080",
        "We Didn't Start the Fire 人工中英对照译文来源",
      ],
    ];
    for (const [label, href, use] of entries) {
      const item = element("li");
      const link = element("a", undefined, label);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link, document.createTextNode(` — ${use}`));
      list.appendChild(item);
    }
    about.append(list);
    body.appendChild(about);
  }
}

