import { BOOT_WALLPAPER_PREVIEW_KEY } from "./defaults";
import { saveWallpaper } from "./wallpaperDb";
import type { WallpaperItem } from "./types";

type BingImageResponse = {
  images: Array<{
    url: string;
    title?: string;
    copyright?: string;
    hsh?: string;
  }>;
};

export function objectUrlFromBlob(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export async function makeThumbnail(blob: Blob, maxSize = 48, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("无法创建缩略图画布");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export function storeBootPreview(dataUrl?: string): void {
  if (!dataUrl) return;
  try {
    localStorage.setItem(BOOT_WALLPAPER_PREVIEW_KEY, dataUrl);
  } catch {
    // Boot preview is an optimization. Ignore quota and privacy-mode failures.
  }
}

export async function importLocalWallpaper(file: File): Promise<WallpaperItem> {
  const blob = file.slice(0, file.size, file.type || "image/jpeg");
  const id = crypto.randomUUID();
  const thumbDataUrl = await makeThumbnail(blob);
  const item: WallpaperItem = {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "本地壁纸",
    source: "local",
    blobId: `blob-${id}`,
    thumbDataUrl,
    createdAt: Date.now()
  };
  await saveWallpaper(item, blob);
  storeBootPreview(thumbDataUrl);
  return item;
}

export async function fetchBingDailyWallpaper(): Promise<WallpaperItem> {
  const response = await fetch("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US");
  if (!response.ok) throw new Error(`Bing 壁纸请求失败：${response.status}`);
  const data = (await response.json()) as BingImageResponse;
  const image = data.images[0];
  if (!image) throw new Error("Bing 没有返回图片");

  const url = new URL(image.url, "https://www.bing.com");
  url.searchParams.set("rf", "LaDigue_1920x1080.jpg");
  const imageResponse = await fetch(url.toString());
  if (!imageResponse.ok) throw new Error(`Bing 图片请求失败：${imageResponse.status}`);
  const blob = await imageResponse.blob();
  const thumbDataUrl = await makeThumbnail(blob);
  const id = `bing-${image.hsh ?? new Date().toISOString().slice(0, 10)}`;
  const item: WallpaperItem = {
    id,
    name: image.title || "Bing 每日壁纸",
    source: "bing",
    blobId: `blob-${id}`,
    thumbDataUrl,
    createdAt: Date.now(),
    attribution: image.copyright
  };
  await saveWallpaper(item, blob);
  storeBootPreview(thumbDataUrl);
  return item;
}
