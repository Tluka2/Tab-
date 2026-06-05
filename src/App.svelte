<script lang="ts">
  import { onMount } from "svelte";
  import { defaultSettings, searchEngines } from "./lib/defaults";
  import { loadSettings, saveSettings } from "./lib/settings";
  import type { AppSettings, Shortcut, WallpaperItem } from "./lib/types";
  import { deleteWallpaper, getWallpaperBlob, listWallpapers, updateWallpaper } from "./lib/wallpaperDb";
  import {
    fetchBingDailyWallpaper,
    importLocalWallpaper,
    objectUrlFromBlob,
    storeBootPreview
  } from "./lib/wallpaper";

  let settings: AppSettings = structuredClone(defaultSettings);
  let wallpapers: WallpaperItem[] = [];
  let activeWallpaperUrl = "";
  let searchQuery = "";
  let settingsOpen = false;
  let shortcutDialogOpen = false;
  let editingShortcut: Shortcut | undefined;
  let shortcutDraft = { name: "", url: "", icon: "", group: "" };
  let searchInput: HTMLInputElement;
  let searchFormEl: HTMLDivElement;
  let status = "";
  let draggedShortcutId = "";

  $: sortedShortcuts = [...settings.shortcuts].sort((a, b) => a.order - b.order);
  $: activeWallpaperItem = wallpapers.find((item) => item.id === settings.wallpaper.activeId);
  $: activeEngine = searchEngines.find((engine) => engine.id === settings.search.engineId) ?? searchEngines[0];
  $: searchTemplate =
    settings.search.engineId === "custom" ? settings.search.customTemplate : activeEngine.template;
  $: appTheme = settings.theme.mode === "auto" ? "" : settings.theme.mode;
  $: backgroundStyle = [
    `--wallpaper-url: ${activeWallpaperUrl ? `url("${activeWallpaperUrl}")` : "var(--boot-wallpaper, none)"}`,
    `--wallpaper-blur: ${settings.wallpaper.blur}px`,
    `--wallpaper-dim: ${settings.wallpaper.dim}`,
    `--wallpaper-brightness: ${settings.wallpaper.brightness}`,
    `--accent: ${settings.theme.accentColor}`,
    `--icon-opacity: ${settings.theme.iconOpacity}`,
    `--panel-alpha: ${settings.theme.panelTransparency}`
  ].join(";");

  onMount(() => {
    void initialize();
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  });

  async function initialize(): Promise<void> {
    settings = await loadSettings();
    wallpapers = await listWallpapers();
    await resolveActiveWallpaper();
  }

  async function persist(next = settings): Promise<void> {
    settings = await saveSettings(next);
  }

  function exportSettings(): void {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Tab",
      settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tab-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { settings?: AppSettings } | AppSettings;
      const imported = "settings" in parsed && parsed.settings ? parsed.settings : parsed;
      await persist(imported as AppSettings);
      wallpapers = await listWallpapers();
      await resolveActiveWallpaper();
      status = "设置已导入。";
    } catch {
      status = "无法导入设置 JSON。";
    } finally {
      input.value = "";
    }
  }

  async function persistCustomTemplate(): Promise<void> {
    if (!settings.search.customTemplate.includes("{query}")) {
      status = "自定义搜索模板必须包含 {query}，已恢复默认值。";
    }
    await persist();
  }

  function normalizeUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  function faviconFor(url: string): string {
    try {
      const parsed = new URL(normalizeUrl(url));
      return `${parsed.origin}/favicon.ico`;
    } catch {
      return "";
    }
  }

  function navigateToSearch(): void {
    const value = searchQuery.trim();
    if (!value) return;
    const looksLikeUrl = /^([a-z]+:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(value);
    const target = looksLikeUrl
      ? normalizeUrl(value)
      : searchTemplate.replace("{query}", encodeURIComponent(value));
    window.location.href = target;
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") navigateToSearch();
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return Boolean(
      element?.closest("input, textarea, select, [contenteditable='true']")
    );
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      settingsOpen = false;
      shortcutDialogOpen = false;
      return;
    }

    if (isTypingTarget(event.target)) return;

    if (settings.keyboard.focusSearch && (event.key === "/" || (event.ctrlKey && event.key.toLowerCase() === "k"))) {
      event.preventDefault();
      searchFormEl?.classList.add("focus-visible");
      searchInput?.focus();
      return;
    }

    if (settings.keyboard.numberShortcuts && /^[1-9]$/.test(event.key)) {
      const shortcut = sortedShortcuts[Number(event.key) - 1];
      if (shortcut) window.location.href = shortcut.url;
    }
  }

  async function resolveActiveWallpaper(): Promise<void> {
    if (settings.wallpaper.source === "rotation") {
      const rotationItems = settings.wallpaper.rotationIds
        .map((id) => wallpapers.find((item) => item.id === id))
        .filter((item): item is WallpaperItem => Boolean(item));
      if (rotationItems.length > 0) {
        const activeIndex = rotationItems.findIndex((item) => item.id === settings.wallpaper.activeId);
        await setActiveWallpaper(rotationItems[(activeIndex + 1) % rotationItems.length], true);
        return;
      }
    }

    const preferred =
      wallpapers.find((item) => item.id === settings.wallpaper.activeId) ??
      wallpapers.find((item) => settings.wallpaper.source !== "rotation" && item.source === settings.wallpaper.source) ??
      wallpapers[0];

    if (preferred) {
      await setActiveWallpaper(preferred, preferred.id !== settings.wallpaper.activeId);
      return;
    }

    if (settings.wallpaper.source === "bing") {
      await refreshBingWallpaper();
    }
  }

  async function setActiveWallpaper(item: WallpaperItem, shouldPersist = true): Promise<void> {
    const blob = await getWallpaperBlob(item.blobId);
    if (!blob) return;
    if (activeWallpaperUrl.startsWith("blob:")) URL.revokeObjectURL(activeWallpaperUrl);
    activeWallpaperUrl = objectUrlFromBlob(blob);
    item.lastUsedAt = Date.now();
    await updateWallpaper(item);
    storeBootPreview(item.thumbDataUrl);
    if (shouldPersist) {
      await persist({
        ...settings,
        wallpaper: { ...settings.wallpaper, activeId: item.id }
      });
    }
  }

  async function useWallpaperSource(source: AppSettings["wallpaper"]["source"]): Promise<void> {
    await persist({
      ...settings,
      wallpaper: { ...settings.wallpaper, source }
    });
    await resolveActiveWallpaper();
  }

  async function showNextRotationWallpaper(): Promise<void> {
    const rotationItems = settings.wallpaper.rotationIds
      .map((id) => wallpapers.find((item) => item.id === id))
      .filter((item): item is WallpaperItem => Boolean(item));
    if (rotationItems.length === 0) return;
    const activeIndex = rotationItems.findIndex((item) => item.id === settings.wallpaper.activeId);
    await persist({
      ...settings,
      wallpaper: { ...settings.wallpaper, source: "rotation" }
    });
    await setActiveWallpaper(rotationItems[(activeIndex + 1) % rotationItems.length]);
  }

  async function toggleWallpaperRotation(item: WallpaperItem, enabled: boolean): Promise<void> {
    const rotationIds = enabled
      ? Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
      : settings.wallpaper.rotationIds.filter((id) => id !== item.id);
    await persist({
      ...settings,
      wallpaper: { ...settings.wallpaper, rotationIds }
    });
  }

  async function refreshBingWallpaper(): Promise<void> {
    status = "正在获取 Bing 壁纸...";
    try {
      const item = await fetchBingDailyWallpaper();
      wallpapers = await listWallpapers();
      await persist({
        ...settings,
        wallpaper: {
          ...settings.wallpaper,
          source: "bing",
          activeId: item.id,
          rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
        }
      });
      await setActiveWallpaper(item, false);
      status = "Bing 壁纸已缓存。";
    } catch (error) {
      status = error instanceof Error ? error.message : "无法获取 Bing 壁纸。";
    }
  }

  async function handleLocalWallpaper(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    status = "正在导入壁纸...";
    const item = await importLocalWallpaper(file);
    wallpapers = await listWallpapers();
    await persist({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        source: "local",
        activeId: item.id,
        rotationIds: Array.from(new Set([...settings.wallpaper.rotationIds, item.id]))
      }
    });
    await setActiveWallpaper(item, false);
    status = "本地壁纸已缓存。";
    input.value = "";
  }

  async function removeWallpaper(item: WallpaperItem): Promise<void> {
    await deleteWallpaper(item);
    wallpapers = await listWallpapers();
    const nextActive = wallpapers[0];
    await persist({
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        activeId: nextActive?.id,
        rotationIds: settings.wallpaper.rotationIds.filter((id) => id !== item.id)
      }
    });
    if (nextActive) await setActiveWallpaper(nextActive, false);
    else activeWallpaperUrl = "";
  }

  function openShortcutDialog(shortcut?: Shortcut): void {
    editingShortcut = shortcut;
    shortcutDraft = {
      name: shortcut?.name ?? "",
      url: shortcut?.url ?? "",
      icon: shortcut?.icon ?? "",
      group: shortcut?.group ?? ""
    };
    shortcutDialogOpen = true;
  }

  async function saveShortcut(): Promise<void> {
    const url = normalizeUrl(shortcutDraft.url);
    if (!shortcutDraft.name.trim() || !url) return;
    const nextShortcuts = editingShortcut
      ? settings.shortcuts.map((item) =>
          item.id === editingShortcut?.id
            ? {
                ...item,
                name: shortcutDraft.name.trim(),
                url,
                group: shortcutDraft.group.trim() || undefined,
                icon: shortcutDraft.icon.trim() || faviconFor(url)
              }
            : item
        )
      : [
          ...settings.shortcuts,
          {
            id: crypto.randomUUID(),
            name: shortcutDraft.name.trim(),
            url,
            group: shortcutDraft.group.trim() || undefined,
            icon: shortcutDraft.icon.trim() || faviconFor(url),
            order: settings.shortcuts.length
          }
        ];
    await persist({ ...settings, shortcuts: nextShortcuts });
    shortcutDialogOpen = false;
  }

  async function deleteShortcut(shortcut: Shortcut): Promise<void> {
    await persist({
      ...settings,
      shortcuts: settings.shortcuts
        .filter((item) => item.id !== shortcut.id)
        .map((item, index) => ({ ...item, order: index }))
    });
  }

  async function reorderShortcut(targetId: string): Promise<void> {
    if (!draggedShortcutId || draggedShortcutId === targetId) return;
    const next = [...sortedShortcuts];
    const from = next.findIndex((item) => item.id === draggedShortcutId);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await persist({ ...settings, shortcuts: next.map((item, index) => ({ ...item, order: index })) });
  }

  async function clearShortcutIcon(shortcut: Shortcut): Promise<void> {
    await persist({
      ...settings,
      shortcuts: settings.shortcuts.map((item) => (item.id === shortcut.id ? { ...item, icon: undefined } : item))
    });
  }
</script>

<svelte:head>
  <title>新标签页</title>
</svelte:head>

<main class:theme-light={appTheme === "light"} class:theme-dark={appTheme === "dark"} style={backgroundStyle}>
  <div class="wallpaper-blur-fill" class:visible={settings.wallpaper.fit === "blur"}></div>
  <div class="wallpaper" class:overlay-soft={settings.wallpaper.overlay === "soft"} class:overlay-vignette={settings.wallpaper.overlay === "vignette"} class:fit-cover={settings.wallpaper.fit === "cover"} class:fit-contain={settings.wallpaper.fit === "contain"} class:fit-fill={settings.wallpaper.fit === "fill"} class:fit-blur={settings.wallpaper.fit === "blur"}></div>

  <section class:pos-upper={settings.layout.searchPosition === "upper"} class:pos-center={settings.layout.searchPosition === "center"} class:pos-lower={settings.layout.searchPosition === "lower"} class="workspace">
    <div bind:this={searchFormEl} class:solid={settings.search.style === "solid"} class:line={settings.search.style === "line"} class:visibility-hover={settings.search.visibility === "hover"} class:visibility-hidden={settings.search.visibility === "hidden"} class="search-shell">
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        aria-label="搜索"
        autocomplete="off"
        placeholder={settings.search.placeholder}
        spellcheck="false"
        on:keydown={handleSearchKeydown}
        on:blur={() => searchFormEl?.classList.remove("focus-visible")}
        on:focus={() => searchFormEl?.classList.add("focus-visible")}
      />
      <button aria-label="搜索" on:click={navigateToSearch}>搜索</button>
      {#if searchQuery.trim()}
        {@const lower = searchQuery.trim().toLowerCase()}
        {@const matches = sortedShortcuts.filter((s) => s.name.toLowerCase().includes(lower) || s.url.toLowerCase().includes(lower))}
        {#if matches.length > 0}
          <div class="search-suggestions">
            {#each matches as shortcut}
              <button type="button" on:click|preventDefault={() => window.location.href = shortcut.url}>
                {#if shortcut.icon}
                  <img alt="" src={shortcut.icon} />
                {/if}
                <span>{shortcut.name}</span>
                <span class="suggestion-url">{shortcut.url}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    {#if settings.layout.showShortcuts}
      <div class:density-compact={settings.layout.shortcutDensity === "compact"} class:density-dense={settings.layout.shortcutDensity === "dense"} class:visibility-hover={settings.layout.shortcutVisibility === "hover"} class:visibility-hidden={settings.layout.shortcutVisibility === "hidden"} class="shortcuts">
        {#each sortedShortcuts as shortcut, index (shortcut.id)}
          <a
            class="shortcut"
            draggable="true"
            href={shortcut.url}
            on:dragstart={() => (draggedShortcutId = shortcut.id)}
            on:dragover|preventDefault
            on:drop|preventDefault={() => reorderShortcut(shortcut.id)}
          >
            <span class="shortcut-index">{index + 1}</span>
            {#if shortcut.icon}
              <img alt="" src={shortcut.icon} on:error={() => clearShortcutIcon(shortcut)} />
            {:else}
              <span class="fallback-icon">{shortcut.name.slice(0, 1).toUpperCase()}</span>
            {/if}
            <span>{shortcut.name}</span>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <button class="settings-button" aria-label="打开设置" on:click={() => (settingsOpen = true)}>设置</button>

  {#if activeWallpaperItem?.attribution}
    <p class="wallpaper-attribution">{activeWallpaperItem.attribution}</p>
  {/if}

  {#if settingsOpen}
    <aside class="panel" aria-label="设置面板">
      <header>
        <h2>设置</h2>
        <button aria-label="关闭设置" on:click={() => (settingsOpen = false)}>关闭</button>
      </header>

      <div class="panel-section">
        <h3>壁纸</h3>
        <div class="button-row">
          <button on:click={refreshBingWallpaper}>Bing 每日壁纸</button>
          <label class="file-button">
            上传
            <input accept="image/*" type="file" on:change={handleLocalWallpaper} />
          </label>
          <button on:click={showNextRotationWallpaper}>下一张</button>
        </div>
        <label>
          来源
          <select value={settings.wallpaper.source} on:change={(event) => useWallpaperSource(event.currentTarget.value as AppSettings["wallpaper"]["source"])}>
            <option value="bing">Bing 每日壁纸</option>
            <option value="local">本地</option>
            <option value="rotation">轮换</option>
          </select>
        </label>
        {#if status}<p class="status">{status}</p>{/if}
        <div class="wallpaper-list">
          {#each wallpapers as item (item.id)}
            <button class:active={item.id === settings.wallpaper.activeId} on:click={() => setActiveWallpaper(item)}>
              {#if item.thumbDataUrl}<img alt="" src={item.thumbDataUrl} />{/if}
              <span>{item.name}</span>
            </button>
            <label class="mini-check">
              <input
                checked={settings.wallpaper.rotationIds.includes(item.id)}
                type="checkbox"
                on:change={(event) => toggleWallpaperRotation(item, event.currentTarget.checked)}
              />
              轮换
            </label>
            <button class="small-danger" aria-label="删除壁纸" on:click={() => removeWallpaper(item)}>删除</button>
          {/each}
        </div>
        <label>模糊 <input type="range" min="0" max="24" bind:value={settings.wallpaper.blur} on:change={() => persist()} /></label>
        <label>变暗 <input type="range" min="0" max="0.75" step="0.01" bind:value={settings.wallpaper.dim} on:change={() => persist()} /></label>
        <label>亮度 <input type="range" min="0.55" max="1.25" step="0.01" bind:value={settings.wallpaper.brightness} on:change={() => persist()} /></label>
        <label>
          遮罩
          <select bind:value={settings.wallpaper.overlay} on:change={() => persist()}>
            <option value="soft">柔和</option>
            <option value="vignette">暗角</option>
            <option value="none">无</option>
          </select>
        </label>
        <label>
          铺满方式
          <select bind:value={settings.wallpaper.fit} on:change={() => persist()}>
            <option value="cover">裁切铺满</option>
            <option value="contain">完整显示</option>
            <option value="fill">拉伸填满</option>
            <option value="blur">模糊填充</option>
          </select>
        </label>
      </div>

      <div class="panel-section">
        <h3>搜索</h3>
        <label>
          搜索引擎
          <select bind:value={settings.search.engineId} on:change={() => persist()}>
            {#each searchEngines as engine}
              <option value={engine.id}>{engine.name}</option>
            {/each}
          </select>
        </label>
        {#if settings.search.engineId === "custom"}
          <label>模板 <input bind:value={settings.search.customTemplate} on:change={persistCustomTemplate} /></label>
        {/if}
        <label>占位文本 <input bind:value={settings.search.placeholder} on:change={() => persist()} /></label>
        <label>
          样式
          <select bind:value={settings.search.style} on:change={() => persist()}>
            <option value="glass">玻璃</option>
            <option value="solid">实色</option>
            <option value="line">线条</option>
          </select>
        </label>
        <label>
          显示
          <select bind:value={settings.search.visibility} on:change={() => persist()}>
            <option value="always">常亮</option>
            <option value="hover">悬停显示</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>
      </div>

      <div class="panel-section">
        <h3>快捷方式</h3>
        <button on:click={() => openShortcutDialog()}>添加快捷方式</button>
        <div class="shortcut-editor-list">
          {#each sortedShortcuts as shortcut (shortcut.id)}
            <div>
              <span>{shortcut.name}</span>
              <button on:click={() => openShortcutDialog(shortcut)}>编辑</button>
              <button on:click={() => deleteShortcut(shortcut)}>删除</button>
            </div>
          {/each}
        </div>
      </div>

      <div class="panel-section">
        <h3>布局</h3>
        <label>
          搜索框位置
          <select bind:value={settings.layout.searchPosition} on:change={() => persist()}>
            <option value="upper">上方</option>
            <option value="center">居中</option>
            <option value="lower">下方</option>
          </select>
        </label>
        <label class="inline"><input type="checkbox" bind:checked={settings.layout.showShortcuts} on:change={() => persist()} /> 显示快捷方式</label>
        <label>
          网格密度
          <select bind:value={settings.layout.shortcutDensity} on:change={() => persist()}>
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
            <option value="dense">密集</option>
          </select>
        </label>
        <label>
          快捷方式显示
          <select bind:value={settings.layout.shortcutVisibility} on:change={() => persist()}>
            <option value="always">常亮</option>
            <option value="hover">悬停显示</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>
      </div>

      <div class="panel-section">
        <h3>主题</h3>
        <label>
          模式
          <select bind:value={settings.theme.mode} on:change={() => persist()}>
            <option value="auto">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
        <label>强调色 <input type="color" bind:value={settings.theme.accentColor} on:change={() => persist()} /></label>
        <label>图标透明度 <input type="range" min="0.35" max="1" step="0.01" bind:value={settings.theme.iconOpacity} on:change={() => persist()} /></label>
        <label>面板透明度 <input type="range" min="0.45" max="0.95" step="0.01" bind:value={settings.theme.panelTransparency} on:change={() => persist()} /></label>
      </div>

      <div class="panel-section">
        <h3>键盘</h3>
        <label class="inline"><input type="checkbox" bind:checked={settings.keyboard.focusSearch} on:change={() => persist()} /> 使用 / 或 Ctrl+K 聚焦搜索</label>
        <label class="inline"><input type="checkbox" bind:checked={settings.keyboard.numberShortcuts} on:change={() => persist()} /> 使用数字键打开快捷方式</label>
      </div>

      <div class="panel-section">
        <h3>数据</h3>
        <div class="button-row">
          <button on:click={exportSettings}>导出设置</button>
          <label class="file-button">
            导入设置
            <input accept="application/json" type="file" on:change={importSettings} />
          </label>
        </div>
      </div>
    </aside>
  {/if}

  {#if shortcutDialogOpen}
    <div class="dialog-backdrop" role="presentation" on:click={() => (shortcutDialogOpen = false)}>
      <form class="dialog" on:click|stopPropagation on:submit|preventDefault={saveShortcut}>
        <h2>{editingShortcut ? "编辑快捷方式" : "添加快捷方式"}</h2>
        <label>名称 <input bind:value={shortcutDraft.name} required /></label>
        <label>网址 <input bind:value={shortcutDraft.url} required /></label>
        <label>图标 URL <input bind:value={shortcutDraft.icon} placeholder="留空则使用网站图标" /></label>
        <label>分组 <input bind:value={shortcutDraft.group} /></label>
        <div class="button-row">
          <button type="submit">保存</button>
          <button type="button" on:click={() => (shortcutDialogOpen = false)}>取消</button>
        </div>
      </form>
    </div>
  {/if}
</main>
