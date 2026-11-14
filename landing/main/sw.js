// The OS moved from /binette/main/ to /binette/live/. Browsers keep an old service worker
// when its script returns 404, so this replacement removes itself and reloads open windows
// to show the notice page in this folder.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.all(windows.map(client => client.navigate(new URL("./", self.registration.scope).href).catch(() => {})));
  })());
});
