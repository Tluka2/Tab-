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

export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function makeThumbnail(blob: Blob, maxSize = 96, quality = 0.72): Promise<string> {
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

export function getBootPreview(item: WallpaperItem): string | undefined {
  return item.previewDataUrl ?? item.thumbDataUrl;
}

export async function createWallpaperAssets(blob: Blob): Promise<{
  thumbDataUrl: string;
  previewDataUrl: string;
  contentHash: string;
}> {
  const [thumbDataUrl, previewDataUrl, contentHash] = await Promise.all([
    makeThumbnail(blob, 96, 0.72),
    makeThumbnail(blob, 640, 0.62),
    hashBlob(blob)
  ]);
  return { thumbDataUrl, previewDataUrl, contentHash };
}

export async function makeWallpaperPalette(blob: Blob, maxSize = 36): Promise<string[]> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    bitmap.close();
    return ["#11191a", "#080d0e", "#101419"];
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < data.length; index += 16) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 18 || luma > 238) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  const colors = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((bucket) => {
      const r = Math.round(bucket.r / bucket.count);
      const g = Math.round(bucket.g / bucket.count);
      const b = Math.round(bucket.b / bucket.count);
      return `rgb(${r} ${g} ${b})`;
    });
  return colors.length >= 2 ? colors : ["#11191a", "#080d0e", "#101419"];
}

export function storeBootPreview(dataUrl?: string, options: { applyToPage?: boolean; persist?: boolean } = {}): void {
  if (!dataUrl) return;
  const applyToPage = options.applyToPage ?? true;
  const persist = options.persist ?? true;
  if (persist) {
    try {
      localStorage.setItem(BOOT_WALLPAPER_PREVIEW_KEY, dataUrl);
    } catch {
      // Boot preview is an optimization. Ignore quota and privacy-mode failures.
    }
  }
  if (!applyToPage) return;
  document.documentElement.style.setProperty("--boot-wallpaper", `url("${dataUrl}")`);
  document.documentElement.classList.add("has-boot-wallpaper");
}

export async function importLocalWallpaper(
  file: File,
  options: { blob?: Blob; contentHash?: string } = {}
): Promise<WallpaperItem> {
  const blob = options.blob ?? file.slice(0, file.size, file.type || "image/jpeg");
  const id = crypto.randomUUID();
  const assets = await createWallpaperAssets(blob);
  const { thumbDataUrl, previewDataUrl } = assets;
  const contentHash = options.contentHash ?? assets.contentHash;
  const item: WallpaperItem = {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "本地壁纸",
    source: "local",
    blobId: `blob-${id}`,
    thumbDataUrl,
    previewDataUrl,
    contentHash,
    createdAt: Date.now()
  };
  await saveWallpaper(item, blob);
  storeBootPreview(previewDataUrl);
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
  const { thumbDataUrl, previewDataUrl, contentHash } = await createWallpaperAssets(blob);
  const id = `bing-${image.hsh ?? new Date().toISOString().slice(0, 10)}`;
  const item: WallpaperItem = {
    id,
    name: image.title || "Bing 每日壁纸",
    source: "bing",
    blobId: `blob-${id}`,
    thumbDataUrl,
    previewDataUrl,
    contentHash,
    createdAt: Date.now(),
    attribution: image.copyright
  };
  await saveWallpaper(item, blob);
  storeBootPreview(previewDataUrl);
  return item;
}
