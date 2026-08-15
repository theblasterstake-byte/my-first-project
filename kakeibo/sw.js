/* オフライン起動と、共有メニューから送られてきた画像の受け取り */
const CACHE = "kakeibo-v2";
const SHARE_CACHE = "kakeibo-share";

/* アプリ本体。OCR 用のファイルは大きいので、初回に使われたときだけ後からキャッシュする */
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./ocr.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

/* 共有された画像をいったんキャッシュに置き、アプリ本体に取りに来てもらう */
async function receiveSharedImage(request) {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    const file = form.get("photos") || form.get("photo") || form.get("file");
    if (file && file.size) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        new URL("shared-image", scope).href,
        new Response(file, {
          headers: {
            "Content-Type": file.type || "image/jpeg",
            "X-Share-Name": encodeURIComponent(file.name || "shared.jpg"),
          },
        })
      );
    }
  } catch (err) {
    console.warn("共有画像を保存できませんでした", err);
  }
  return Response.redirect(new URL("index.html?shared=1", scope).href, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname.endsWith("/share")) {
    event.respondWith(receiveSharedImage(event.request));
    return;
  }

  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          // 同一オリジンの取得できたものはキャッシュしておく（OCR のモデルもここで入る）
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});
