self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Push → toast nativo do Windows (Action Center / canto inferior direito). */

function assetUrl(relativePath) {
  return new URL(relativePath, self.registration.scope).href;
}

function parsePushPayload(event) {
  const defaults = {
    title: "SAGRA Web",
    body: "Nova notificação",
    url: self.registration.scope,
    tag: "sagra-os",
    nro: null,
    ano: null,
  };
  if (!event.data) {
    return defaults;
  }
  try {
    return { ...defaults, ...event.data.json() };
  } catch {
    try {
      return { ...defaults, body: event.data.text() };
    } catch {
      return defaults;
    }
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const tag =
    payload.tag ||
    (payload.nro && payload.ano
      ? `sagra-os-${payload.nro}-${payload.ano}`
      : "sagra-os");

  event.waitUntil(
    self.registration.showNotification(payload.title || "SAGRA Web", {
      body: payload.body || "",
      icon: assetUrl("icons/icon-192.png"),
      badge: assetUrl("icons/favicon-32.png"),
      data: {
        url: payload.url || self.registration.scope,
        nro: payload.nro ?? null,
        ano: payload.ano ?? null,
      },
      tag,
      renotify: true,
      requireInteraction: false,
      silent: false,
      timestamp: Date.now(),
      lang: "pt-BR",
      dir: "ltr",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (!client.url.startsWith(self.registration.origin)) {
            continue;
          }
          if ("focus" in client) {
            await client.focus();
            if ("navigate" in client && typeof client.navigate === "function") {
              try {
                await client.navigate(targetUrl);
                return;
              } catch {
                /* abre nova janela abaixo */
              }
            }
            return;
          }
        }
        if (clients.openWindow) {
          await clients.openWindow(targetUrl);
        }
      }),
  );
});
