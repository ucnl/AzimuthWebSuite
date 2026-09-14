const CACHE = 'aws-v2';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './serial-bridge.js',
  './webview-stub.js',
  './logger.js',
  './log-storage.js',
  './log-analyzer.js',
  './geo-utils.js',
  './vincenty.js',
  './haversine.js',
  './dh-filter.js',
  './median.js',
  './smoother.js',
  './dh-filter-xyz.js',
  './smoother-xyz.js',
  './calibration.js',
  './gnss-parser.js',
  './azm-parser.js',
  './antenna-corrector.js',
  './antenna-table-calibration.js',
  './sound-speed.js',
  './azm-manager.js',
  './utm.js',
  './tracks.js',
  './poi-manager.js',
  './export.js',
  './modules/ui-themes.js',
  './modules/ui-settings.js',
  './modules/ui-ruler.js',
  './modules/ui-topo.js',
  './modules/ui-calibration.js',
  './modules/ui-antenna-calibration.js',
  './modules/ui-canvas.js',
  './modules/ui-wizard.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});