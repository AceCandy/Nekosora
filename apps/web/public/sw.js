/**
 * Nekusora Service Worker
 *
 * 策略:
 *   - 预缓存应用壳(图标、manifest)
 *   - 导航请求:Network First(保证 chat 动态内容新鲜,离线时回退壳)
 *   - 静态资源(_next/static、图片):Stale While Revalidate
 *   - API / SSE / 流式:绝不拦截(放行给浏览器)
 *
 * 版本号升级时(VERSION 常量)会触发 activate 清理旧缓存。
 */
const VERSION = "v1.1.0";
const APP_SHELL_CACHE = `nekusora-shell-${VERSION}`;
const RUNTIME_CACHE = `nekusora-runtime-${VERSION}`;

// 预缓存:应用壳资源(体积小,变更少)。
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/icon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/shortcut-96.png",
];

// ===== Install:预缓存应用壳 =====
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      // 预缓存失败(如离线安装)不阻断 SW 激活。
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

// ===== Activate:清理旧版本缓存 =====
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ===== Fetch:按资源类型分流 =====
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 只处理同源 GET。POST/PUT/流式网关请求全部放行。
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API / 流式 / 鉴权端点:绝不缓存(放行)。
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) {
    return;
  }

  // 导航请求(HTML 页面):Network First,离线回退壳。
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态构建产物 + 图片:Stale While Revalidate。
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 其余同源 GET:走 runtime 缓存(网络优先)。
  event.respondWith(networkFirst(request));
});

/** Network First:优先网络,失败时回退缓存。用于导航和动态页。 */
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, fresh.clone()).catch(() => undefined);
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // 离线且无缓存:回退到应用壳首页。
    return caches.match("/");
  }
}

/** Stale While Revalidate:立即返回缓存,后台更新。用于不可变静态资源。 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((fresh) => {
      cache.put(request, fresh.clone()).catch(() => undefined);
      return fresh;
    })
    .catch(() => cached);
  return cached || network;
}
