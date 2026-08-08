/* Service worker for Render HTTPS OS notifications */
self.addEventListener("push", (event) => {
  let data = { title: "Fire Before Fire", body: "Hazard alert", level: "warn" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    try {
      data.body = event.data.text();
    } catch (_) {}
  }
  const title =
    data.level === "critical"
      ? data.title || "Fire Before Fire — CRITICAL"
      : data.title || "Fire Before Fire";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "fbf-os",
      renotify: true,
      requireInteraction: data.level === "critical",
      data: { url: data.url || "/notify" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notify";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
