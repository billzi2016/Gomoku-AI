/*
 * COOP/COEP Service Worker。
 *
 * GitHub Pages 不能配置响应头，所以用 Service Worker 给同源静态资源补
 * Cross-Origin-Opener-Policy 和 Cross-Origin-Embedder-Policy。
 */

const COOP = "same-origin";
const COEP = "require-corp";

if (typeof window !== "undefined" && window.navigator && navigator.serviceWorker) {
    /*
     * 页面线程分支。
     *
     * 同一个文件既被 <script> 加载，也被 Service Worker 注册加载。
     * 在页面线程里只负责注册；真正拦截请求的逻辑放在下面的 Service Worker 分支。
     */
    navigator.serviceWorker.register("./coi-serviceworker.js").then((registration) => {
        if (!navigator.serviceWorker.controller) return;
        if (registration.active && !crossOriginIsolated) {
            // 首次注册后需要刷新一次，页面才会被新的 Service Worker 控制。
            window.location.reload();
        }
    });
}

if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
    self.addEventListener("install", (event) => {
        // 立即激活新版本，避免 GitHub Pages 缓存旧 Service Worker 太久。
        event.waitUntil(self.skipWaiting());
    });

    self.addEventListener("activate", (event) => {
        // 让已经打开的页面也尽快进入当前 Service Worker 控制范围。
        event.waitUntil(self.clients.claim());
    });

    self.addEventListener("fetch", (event) => {
        /*
         * 给同源静态资源补 COOP/COEP。
         *
         * GitHub Pages 不能设置这些响应头，所以只能在客户端拦截响应后重包。
         * 这不会给第三方跨源资源绕过 CORS，只是让本站资源满足 crossOriginIsolated。
         */
        if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
            return;
        }

        event.respondWith(fetch(event.request).then((response) => {
            const headers = new Headers(response.headers);
            headers.set("Cross-Origin-Opener-Policy", COOP);
            headers.set("Cross-Origin-Embedder-Policy", COEP);
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        }));
    });
}
