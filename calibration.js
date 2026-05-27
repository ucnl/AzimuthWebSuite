// calibration.js — Калибратор углового смещения антенны (phi)
const AngularCalibration = (() => {

    let points = [];
    let dhFilter = null;
    let sFilter = null;
    let xOffset = 0, yOffset = 0;

    function reset() {
        points = [];
        if (dhFilter) dhFilter.reset();
        if (sFilter) sFilter.reset();
    }

    function init() {
        dhFilter = new DHTrackFilter(8, 1, 5);
        sFilter = new TrackMovingAverageSmoother(4, 50);
        reset();
    }

    function addPoint(ts, headingDeg, latDeg, lonDeg, azmDeg, srpM, ptimeS, adptM, rdptM) {
        points.push({
            ts, hdn: headingDeg,
            lat: latDeg, lon: lonDeg,
            azm: azmDeg, srp: srpM,
            ptime: ptimeS, adpt: adptM, rdpt: rdptM,
        });
    }

    function getCount() { return points.length; }

    // Перевод гео-координат в метры относительно центра
    function geoToLocal(geoPoints) {
        // Центроид
        let cLat = 0, cLon = 0;
        geoPoints.forEach(p => { cLat += p.lat; cLon += p.lon; });
        cLat /= geoPoints.length;
        cLon /= geoPoints.length;

        const cLatRad = cLat * Math.PI / 180;
        const cLonRad = cLon * Math.PI / 180;

        return geoPoints.map(p => {
            const mlat = (cLatRad + p.lat * Math.PI / 180) / 2;
            const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
            const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
            return {
                x: (p.lon * Math.PI / 180 - cLonRad) * mPerDegLon,
                y: (p.lat * Math.PI / 180 - cLatRad) * mPerDegLat,
            };
        });
    }

    function std2D(localPoints) {
        let cx = 0, cy = 0;
        localPoints.forEach(p => { cx += p.x; cy += p.y; });
        cx /= localPoints.length;
        cy /= localPoints.length;

        let sx = 0, sy = 0;
        localPoints.forEach(p => {
            sx += (p.x - cx) ** 2;
            sy += (p.y - cy) ** 2;
        });
        return {
            sigmax: Math.sqrt(sx / localPoints.length),
            sigmay: Math.sqrt(sy / localPoints.length),
        };
    }

    function drms(sigmax, sigmay) {
        return Math.sqrt(sigmax * sigmax + sigmay * sigmay);
    }

    function* getAngles(fromDeg, toDeg, stepDeg) {
        fromDeg = ((fromDeg % 360) + 360) % 360;
        toDeg = ((toDeg % 360) + 360) % 360;
        if (toDeg <= fromDeg) toDeg += 360;
        for (let a = fromDeg; a <= toDeg + stepDeg / 2; a += stepDeg) {
            yield a % 360;
        }
    }

    function calibratePhi(fromAngleDeg, toAngleDeg, stepDeg) {
        if (points.length < 10) return NaN;

        let bestDrms = Infinity;
        let bestPhi = fromAngleDeg;

        for (const phi of getAngles(fromAngleDeg, toAngleDeg, stepDeg)) {
            dhFilter.reset();
            sFilter.reset();

            const validPoints = [];

            for (const cp of points) {
                const pol = polarCS_ShiftRotate(cp.hdn, phi, cp.azm, cp.srp, xOffset, yOffset);
                const geo = directGeodetic(
                    cp.lat * Math.PI / 180, cp.lon * Math.PI / 180,
                    pol.a_deg * Math.PI / 180, pol.r_a
                );

                const now = cp.ts;
                if (dhFilter.process(geo.lat, geo.lon, cp.rdpt || 0, now).accepted) {
                    const sm = sFilter.process(geo.lat, geo.lon, cp.rdpt || 0, now);
                    validPoints.push({
                        lat: sm.lat * 180 / Math.PI,
                        lon: sm.lon * 180 / Math.PI,
                    });
                }
            }

            if (validPoints.length >= 5) {
                const local = geoToLocal(validPoints);
                const std = std2D(local);
                const d = drms(std.sigmax, std.sigmay);
                if (d < bestDrms) {
                    bestDrms = d;
                    bestPhi = phi;
                }
            }
        }

        return bestPhi;
    }

    // Зависимости от azm-manager (должны быть доступны глобально)
    function polarCS_ShiftRotate(hdg, phi, bng, rM, xt, yt) {
        const teta = ((bng + phi) * Math.PI / 180) % (2 * Math.PI);
        const xr = xt + rM * Math.sin(teta);
        const yr = yt + rM * Math.cos(teta);
        let a_r = Math.atan2(xr, yr);
        if (a_r < 0) a_r += 2 * Math.PI;
        a_r += hdg * Math.PI / 180;
        a_r = a_r % (2 * Math.PI);
        return {
            a_deg: a_r * 180 / Math.PI,
            r_a: Math.sqrt(xr * xr + yr * yr),
        };
    }

    function directGeodetic(latRad, lonRad, azmRad, distM) {
        const v = Vincenty.vincentyDirect(latRad, lonRad, azmRad, distM);
        return v.converged ? v : Haversine.haversineDirect(latRad, lonRad, distM, azmRad);
    }

    init();

    return {
        reset, addPoint, getCount, calibratePhi,
        setOffsets: (x, y) => { xOffset = x; yOffset = y; },
    };

})();