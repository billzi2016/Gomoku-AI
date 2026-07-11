/*
 * COOP/COEP Service Worker。
 *
 * GitHub Pages 不能配置响应头，所以用 Service Worker 给同源静态资源补
 * Cross-Origin-Opener-Policy 和 Cross-Origin-Embedder-Policy。
 */

const COOP = "same-origin";
const COEP = "require-corp";

if (typeof window !== "undefined" && window.navigator && navigator.serviceWorker) {
    navigator.serviceWorker.register("./coi-serviceworker.js").then((registration) => {
        if (!navigator.serviceWorker.controller) return;
        if (registration.active && !crossOriginIsolated) {
            window.location.reload();
        }
    });
}

if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
    self.addEventListener("install", (event) => {
        event.waitUntil(self.skipWaiting());
    });

    self.addEventListener("activate", (event) => {
        event.waitUntil(self.clients.claim());
    });

    self.addEventListener("fetch", (event) => {
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
