(() => {
  try {
    const preview = localStorage.getItem("tab.bootWallpaperPreview");
    if (preview) {
      document.documentElement.style.setProperty("--boot-wallpaper", `url("${preview}")`);
      document.documentElement.classList.add("has-boot-wallpaper");
    }
  } catch {}
})();
