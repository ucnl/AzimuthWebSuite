// smoother.js — TrackMovingAverageSmoother (взвешенное скользящее среднее)
// Портировано с C# UCNLNav.TrackFilters.TrackMovingAverageSmoother

const SmoothModule = (() => {

    class MPoint {
        constructor(x, y) {
            this.x = x;
            this.y = y;
        }
    }

    class TrackMovingAverageSmoother {
        constructor(filterSize = 4, resetDeltaM = 3000) {
            if (resetDeltaM <= 0) throw new Error('resetDeltaM must be > 0');
            if (filterSize <= 0) throw new Error('filterSize must be > 0');

            this.filterSize = filterSize;
            this.maxDistToReset = resetDeltaM;

            this.points = [];
            this.anchorLat = NaN;
            this.anchorLon = NaN;
            this.prevLat = NaN;
            this.prevLon = NaN;
        }

        process(lat, lon, dpt, ts) {
            if (this.points.length === 0) {
                this.anchorLat = lat;
                this.anchorLon = lon;
                this.points.push(new MPoint(0, 0));
                this.prevLat = lat;
                this.prevLon = lon;
                return { lat, lon, dpt, ts };
            }

            const distToPrev = haversineInverse(
                this.prevLat, this.prevLon, lat, lon, Haversine.WGS84_A
            );

            if (distToPrev >= this.maxDistToReset) {
                this.reset();
                this.anchorLat = lat;
                this.anchorLon = lon;
                this.points.push(new MPoint(0, 0));
                this.prevLat = lat;
                this.prevLon = lon;
                return { lat, lon, dpt, ts };
            }

            if (this.points.length >= this.filterSize) {
                this.points.shift();
            }

            const deltas = getDeltasByGeopoints_WGS84(this.anchorLat, this.anchorLon, lat, lon);
            this.points.push(new MPoint(deltas.deltaLonM, deltas.deltaLatM));

            let meanX = 0, meanY = 0;
            for (let i = 0; i < this.points.length; i++) {
                const weight = i + 1;
                meanX += this.points[i].x * weight;
                meanY += this.points[i].y * weight;
            }

            const fWeight = (this.points.length + this.points.length * this.points.length) / 2.0;
            meanX /= fWeight;
            meanY /= fWeight;

            const result = geopointOffsetByDeltas_WGS84(this.anchorLat, this.anchorLon, meanY, meanX);
            this.prevLat = result.lat;
            this.prevLon = result.lon;

            return { lat: result.lat, lon: result.lon, dpt, ts };
        }

        reset() {
            this.points = [];
            this.anchorLat = NaN;
            this.anchorLon = NaN;
            this.prevLat = NaN;
            this.prevLon = NaN;
        }
    }

    function getDeltasByGeopoints_WGS84(lat1, lon1, lat2, lon2) {
        const mlat = (lat1 + lat2) / 2.0;
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * mlat) + 1.175 * Math.cos(4.0 * mlat);
        const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3.0 * mlat);
        const deltaLatM = (lat1 - lat2) * mPerDegLat * (180.0 / Math.PI);
        const deltaLonM = (lon1 - lon2) * mPerDegLon * (180.0 / Math.PI);
        return { deltaLatM, deltaLonM };
    }

    function geopointOffsetByDeltas_WGS84(lat, lon, deltaLatM, deltaLonM) {
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2.0 * lat) + 1.175 * Math.cos(4.0 * lat);
        const mPerDegLon = 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3.0 * lat);
        const newLat = lat - (Math.PI / 180.0) * deltaLatM / mPerDegLat;
        const newLon = lon - (Math.PI / 180.0) * deltaLonM / mPerDegLon;
        return { lat: newLat, lon: newLon };
    }

    // Экспорт в глобальную область
    window.TrackMovingAverageSmoother = TrackMovingAverageSmoother;
    window.getDeltasByGeopoints_WGS84 = getDeltasByGeopoints_WGS84;
    window.geopointOffsetByDeltas_WGS84 = geopointOffsetByDeltas_WGS84;

    return TrackMovingAverageSmoother;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrackMovingAverageSmoother;
}