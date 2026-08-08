/**
 * Web Push (OS notifications) via VAPID — HTTPS Render only.
 * SoftAP HTTP cannot grant Notification permission in modern browsers.
 */
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

function createPushStore(opts = {}) {
  const dataDir = opts.dataDir;
  const subsPath = path.join(dataDir, "push_subscriptions.json");
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:fire-before-fire@localhost";

  const enabled = !!(publicKey && privateKey);
  if (enabled) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  function load() {
    try {
      if (!fs.existsSync(subsPath)) return [];
      const raw = JSON.parse(fs.readFileSync(subsPath, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function save(list) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(subsPath, JSON.stringify(list, null, 2));
  }

  function list(deviceId) {
    const all = load();
    if (!deviceId) return all;
    return all.filter((s) => s.deviceId === deviceId || s.deviceId === "*");
  }

  function subscribe(deviceId, subscription, meta = {}) {
    if (!subscription || !subscription.endpoint) {
      return { ok: false, error: "invalid subscription" };
    }
    const id = String(deviceId || "esp32-01");
    const all = load().filter((s) => s.endpoint !== subscription.endpoint);
    all.push({
      deviceId: id,
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      userAgent: meta.userAgent || "",
      subscribedAt: new Date().toISOString(),
    });
    save(all);
    return { ok: true, count: all.filter((s) => s.deviceId === id).length };
  }

  function unsubscribe(endpoint) {
    const all = load().filter((s) => s.endpoint !== endpoint);
    save(all);
    return { ok: true };
  }

  async function notifyDevice(deviceId, payload) {
    if (!enabled) {
      return { ok: false, error: "VAPID keys not configured", sent: 0 };
    }
    const id = String(deviceId || "esp32-01");
    const targets = list(id);
    const body = JSON.stringify(
      typeof payload === "string"
        ? { title: "Fire Before Fire", body: payload }
        : payload,
    );
    const level =
      typeof payload === "object" && payload && payload.level === "critical"
        ? "critical"
        : "warn";
    let sent = 0;
    const gone = [];
    for (const sub of targets) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          body,
          // Longer TTL: phones often wake slowly; 60s dropped many deliveries.
          { TTL: 3600, urgency: level === "critical" ? "high" : "high" },
        );
        sent++;
      } catch (e) {
        const code = e.statusCode || e.status;
        if (code === 404 || code === 410) gone.push(sub.endpoint);
        console.warn("[push] send fail", code || e.message);
      }
    }
    if (gone.length) {
      save(load().filter((s) => !gone.includes(s.endpoint)));
    }
    return { ok: true, sent, subscribers: targets.length, removed: gone.length };
  }

  return {
    enabled,
    publicKey,
    subscribe,
    unsubscribe,
    notifyDevice,
    count: () => load().length,
  };
}

module.exports = { createPushStore };
