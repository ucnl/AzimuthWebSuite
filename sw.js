const CACHE = 'aws-v4';

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
  './achod-bearing-filter.js',
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
  './modules/ui-wizard.js',
  './README.html',
  './CHANGELOG.html',
  './docs/guide.html'
  
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
    // 1. Не трогаем чужие origin'ы (CDN, GitHub, docs и т.д.)
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) {
        return;
    }
    
    // 2. Навигационные запросы — всегда index.html из кэша
    //    (покрывает ?native=1, ?foo=bar, #hash и т.д.)
    if (event.request.mode === 'navigate') {
        event.respondWith(
            caches.match('./index.html', { ignoreSearch: true }).then((cached) => {
                return cached || fetch(event.request);
            })
        );
        return;
    }
    
    // 3. Остальные запросы — cache-first с игнором query string
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cached) => {
            return cached || fetch(event.request);
        })
    );
});