// color-cache.js — кэш CSS-переменных для горячего пути отрисовки.
// Читает getComputedStyle один раз; сбрасывается при смене темы.

const ColorCache = (() => {
    let cache = null;

    function read() {
        const rootStyles = getComputedStyle(document.documentElement);
        const get = (name, fallback) => {
            const v = rootStyles.getPropertyValue(name).trim();
            return v || fallback;
        };
        const getFloat = (name, fallback) => {
            const v = rootStyles.getPropertyValue(name).trim();
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : fallback;
        };
        return {
            // tracks.js
            trackStationLine: get('--track-station-line', 'rgba(0, 255, 255, 0.7)'),
            trackStationGlow: get('--track-station-glow', 'rgba(0, 255, 255, 0.35)'),
            trackBeaconLineAlpha: getFloat('--track-beacon-line-alpha', 0.8),
            trackBeaconGlowColor: get('--track-beacon-glow-color', ''), // если пусто — берём hue

            // ui-canvas.js (для будущего рефакторинга)
            mapText: get('--map-text', '#ffffff'),
            mapTextSecondary: get('--map-text-secondary', 'rgba(255, 255, 255, 0.8)'),
            mapStroke: get('--map-stroke', '#ffffff'),
            mapGrid: get('--map-grid', 'rgba(255, 255, 255, 0.06)'),
            mapAxis: get('--map-axis', 'rgba(255, 255, 255, 0.2)'),
            beaconTimeoutColor: get('--beacon-timeout-color', '#dc3545'),
            beaconWarningColor: get('--beacon-warning-color', '#ffc107'),
            beaconRejectedColor: get('--beacon-rejected-color', 'rgba(128, 128, 128, 0.45)'),
            referenceBeaconColor: get('--reference-beacon-color', '#ffcc00'),
            referenceBeaconGlow: get('--reference-beacon-glow', 'rgba(255, 204, 0, 0.3)'),
            poiMarkedColor: get('--poi-marked-color', '#ffcc00'),
            poiLoadedColor: get('--poi-loaded-color', '#ff6600'),
            antennaHeadingColor: get('--antenna-heading-color', '#ff4444'),
            scaleShadow: get('--scale-shadow', '#000'),
        };
    }

    return {
        get() {
            if (!cache) cache = read();
            return cache;
        },
        invalidate() {
            cache = null;
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ColorCache;