// Service Worker: 朝のまとめ通知の受信・表示(設計書 §12.4, architecture.md)。
// PWAのインストール可否のためだけの最小実装(オフラインキャッシュ等は持たない)。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "家事管理", body: "", url: "/" };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // JSONでなければ既定の文言のまま表示する。
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "家事管理", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === url && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
