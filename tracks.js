// tracks.js — Управление треками маяков и экспорт в KML
// v5: единая система координат (метры), станция в (0,0) при отсутствии GNSS

const TrackManager = (() => {

    // ========== ХРАНИЛИЩЕ ТРЕКОВ ==========
    let tracks = {};            // { [beaconAddress]: [{ x, y, lat, lon, ... }] }
    let stationTrack = [];     // [{ x, y, lat, lon, ts }]    
	const MAX_STORED_POINTS = 50000;      // для маяков
    const MAX_STORED_STATION = 50000;     // для станции

    // Якорь — первая точка станции с GNSS
    let anchorLat = NaN, anchorLon = NaN;

    // ========== НАСТРОЙКИ ==========
    let settings = {
        maxPointsPerTrack: 500,
        minPointDistanceM: 0.05,
        showTracks: true,
    };

    // ========== КООРДИНАТЫ ==========

    function setAnchor(lat, lon) {
        anchorLat = lat;
        anchorLon = lon;
    }

    function geoToMeters(lat, lon) {
        if (isNaN(anchorLat) || isNaN(anchorLon)) return { x: 0, y: 0 };
        const mlat = (lat + anchorLat) / 2 * Math.PI / 180;
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
        const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
        return {
            x: (lon - anchorLon) * mPerDegLon,
            y: (lat - anchorLat) * mPerDegLat,
        };
    }

    function getAnchor() {
        return { lat: anchorLat, lon: anchorLon };
    }

    // ========== ТРЕК СТАНЦИИ ==========

    function addStationPoint(lat, lon) {
        if (isNaN(lat) || isNaN(lon)) return;

        // Первая точка с GNSS — якорь
        if (stationTrack.length === 0 && !isNaN(lat)) {
            setAnchor(lat, lon);
        }

        const m = geoToMeters(lat, lon);

        // Не добавляем если координаты не изменились
        if (stationTrack.length > 0) {
            const last = stationTrack[stationTrack.length - 1];
            if (Math.abs(m.x - last.x) < 0.001 && Math.abs(m.y - last.y) < 0.001) return;
        }

        stationTrack.push({ x: m.x, y: m.y, lat, lon, ts: Date.now() });		
        while (stationTrack.length > MAX_STORED_STATION) stationTrack.shift();
    }

    function clearStationTrack() {
        stationTrack = [];
        anchorLat = NaN;
        anchorLon = NaN;
    }

	function drawStationTrack(ctx, offsetX, offsetY, scale) {
		if (stationTrack.length < 2) return;

		const drawCount = settings.maxPointsPerTrack;
		const startIdx = Math.max(0, stationTrack.length - drawCount);

		// Свечение
		ctx.beginPath();
		let first = true;
		for (let i = startIdx; i < stationTrack.length; i++) {
			const point = stationTrack[i];
			const x = offsetX + point.x * scale;
			const y = offsetY - point.y * scale;
			if (first) { ctx.moveTo(x, y); first = false; }
			else { ctx.lineTo(x, y); }
		}
		if (!first) {
			ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
			ctx.lineWidth = 6;
			ctx.stroke();
		}

		// Основная линия
		ctx.beginPath();
		first = true;
		for (let i = startIdx; i < stationTrack.length; i++) {
			const point = stationTrack[i];
			const x = offsetX + point.x * scale;
			const y = offsetY - point.y * scale;
			if (first) { ctx.moveTo(x, y); first = false; }
			else { ctx.lineTo(x, y); }
		}
		if (!first) {
			ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}
	}

    // ========== ТРЕКИ МАЯКОВ ==========

    function addPoint(address, dist, azm, lat, lon, dpt, isTimeout) {
        if (isNaN(dist) || isNaN(azm)) return;

        if (!tracks[address]) {
            tracks[address] = [];
        }

        const track = tracks[address];

        // Вычисляем метры: если есть абсолютные координаты — от якоря, иначе — полярные от станции
        let x, y;
        if (!isNaN(lat) && !isNaN(lon) && !isNaN(anchorLat)) {
            const m = geoToMeters(lat, lon);
            x = m.x;
            y = m.y;
        } else {
            x = NaN;
            y = NaN;
        }

        // Фильтрация по минимальной дистанции
        if (track.length > 0 && settings.minPointDistanceM > 0) {
            const last = track[track.length - 1];
            if (!last.isTimeout) {
                if (!isNaN(x) && !isNaN(last.x)) {
                    const d = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2);
                    if (d < settings.minPointDistanceM) return;
                } else {
                    const angDiff = (azm - last.azm) * Math.PI / 180;
                    const d = Math.sqrt(dist * dist + last.dist * last.dist - 2 * dist * last.dist * Math.cos(angDiff));
                    if (d < settings.minPointDistanceM) return;
                }
            }
        }

        track.push({
            dist, azm,
            x, y,
            lat: !isNaN(lat) ? lat : null,
            lon: !isNaN(lon) ? lon : null,
            dpt: isNaN(dpt) ? 0 : dpt,
            ts: Date.now(),
            isTimeout: !!isTimeout,
        });

        while (track.length > MAX_STORED_POINTS) track.shift();
    }

    // ========== ОЧИСТКА ==========

    function clearAll() {
        tracks = {};
        stationTrack = [];
        anchorLat = NaN;
        anchorLon = NaN;
    }

    function clearBeacon(address) {
        delete tracks[address];
    }

    function getTrack(address) { return tracks[address] || []; }
    function getTrackedAddresses() { return Object.keys(tracks).map(Number); }

    // ========== НАСТРОЙКИ ==========

    function setMaxPoints(n) {
        settings.maxPointsPerTrack = Math.max(10, Math.min(100000, n));
        for (const addr in tracks) {
            while (tracks[addr].length > settings.maxPointsPerTrack) tracks[addr].shift();
        }
    }

    function setMinDistance(m) { settings.minPointDistanceM = Math.max(0, Math.min(100, m)); }
    function setShowTracks(show) { settings.showTracks = !!show; }
    function toggleShowTracks() { settings.showTracks = !settings.showTracks; return settings.showTracks; }
    function getSettings() { return { ...settings }; }

    // ========== ОТРИСОВКА ТРЕКОВ МАЯКОВ ==========

	function drawTracks(ctx, offsetX, offsetY, scale) {
		if (!settings.showTracks) return;

		for (const addr in tracks) {
			const track = tracks[addr];
			if (track.length < 2) continue;

			const hue = (parseInt(addr) * 60) % 360;
			const drawCount = settings.maxPointsPerTrack;
			const startIdx = Math.max(0, track.length - drawCount);

			// Свечение
			ctx.beginPath();
			let first = true;
			for (let i = startIdx; i < track.length; i++) {
				const point = track[i];
				if (point.isTimeout) continue;

				let x, y;
				if (!isNaN(point.x)) {
					x = offsetX + point.x * scale;
					y = offsetY - point.y * scale;
				} else {
					const ang = point.azm * Math.PI / 180;
					x = offsetX + point.dist * Math.sin(ang) * scale;
					y = offsetY - point.dist * Math.cos(ang) * scale;
				}

				if (first) { ctx.moveTo(x, y); first = false; }
				else { ctx.lineTo(x, y); }
			}
			if (!first) {
				ctx.strokeStyle = `hsla(${hue}, 80%, 65%, 0.2)`;
				ctx.lineWidth = 7;
				ctx.stroke();
			}

			// Основная линия
			ctx.beginPath();
			first = true;
			for (let i = startIdx; i < track.length; i++) {
				const point = track[i];
				if (point.isTimeout) continue;

				let x, y;
				if (!isNaN(point.x)) {
					x = offsetX + point.x * scale;
					y = offsetY - point.y * scale;
				} else {
					const ang = point.azm * Math.PI / 180;
					x = offsetX + point.dist * Math.sin(ang) * scale;
					y = offsetY - point.dist * Math.cos(ang) * scale;
				}

				if (first) { ctx.moveTo(x, y); first = false; }
				else { ctx.lineTo(x, y); }
			}
			if (!first) {
				ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.8)`;
				ctx.lineWidth = 3;
				ctx.stroke();
			}
		}
	}

    // ========== ЭКСПОРТ KML ==========

	 function exportKML(name) {
		name = name || 'Zima2_USBL_Tracks';
		const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
		let kml = `<kml xmlns="http://www.opengis.net/kml/2.2">
	  <Document>
		<name>${escapeXml(name)}</name>
		<description>Zima2 USBL треки. Экспортировано: ${new Date().toISOString()}</description>
	`;

		// Стили маяков
		for (const addr in tracks) {
			const hue = (parseInt(addr) * 60) % 360;
			const hex = hslToHex(hue, 70, 55);
			kml += `
		<Style id="beacon_${addr}_style">
		  <LineStyle><color>ff${hex.substring(4, 6)}${hex.substring(2, 4)}${hex.substring(0, 2)}</color><width>3</width></LineStyle>
		</Style>`;
		}

		// Стиль станции
		kml += `
		<Style id="station_style">
		  <LineStyle><color>ff00ffff</color><width>3</width></LineStyle>
		</Style>`;

		// Треки маяков
		for (const addr in tracks) {
			const track = tracks[addr];
			if (track.length < 2) continue;
			const valid = track.filter(p => !p.isTimeout && p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
			if (valid.length < 2) continue;
			kml += `
		<Placemark>
		  <name>Маяк #${parseInt(addr) + 1}</name>
		  <styleUrl>#beacon_${addr}_style</styleUrl>
		  <LineString><tessellate>1</tessellate><coordinates>
	${valid.map(p => `        ${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`).join('\n')}
		  </coordinates></LineString>
		</Placemark>`;
		}

		// Трек станции
		if (stationTrack.length >= 2) {
			const validSt = stationTrack.filter(p => p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
			if (validSt.length >= 2) {
				kml += `
		<Placemark>
		  <name>Станция</name>
		  <styleUrl>#station_style</styleUrl>
		  <LineString><tessellate>1</tessellate><coordinates>
	${validSt.map(p => `        ${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`).join('\n')}
		  </coordinates></LineString>
		</Placemark>`;
			}
		}

		kml += `\n  </Document>\n</kml>`;
		return xmlHeader + '\n' + kml;
	}

    function downloadKML(filename) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        filename = filename || `zima2_tracks_${ts}.kml`;
        const blob = new Blob([exportKML()], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    function getStats() {
        const stats = {};
        for (const addr in tracks) {
            const track = tracks[addr];
            const valid = track.filter(p => !p.isTimeout);
            if (valid.length === 0) continue;
            let totalDist = 0;
            for (let i = 1; i < valid.length; i++) {
                if (!isNaN(valid[i].x) && !isNaN(valid[i-1].x)) {
                    totalDist += Math.sqrt((valid[i].x - valid[i-1].x) ** 2 + (valid[i].y - valid[i-1].y) ** 2);
                } else {
                    const a1 = valid[i-1].azm * Math.PI / 180;
                    const a2 = valid[i].azm * Math.PI / 180;
                    totalDist += Math.sqrt(valid[i-1].dist ** 2 + valid[i].dist ** 2 - 2 * valid[i-1].dist * valid[i].dist * Math.cos(a2 - a1));
                }
            }
            stats[addr] = { totalPoints: track.length, validPoints: valid.length, totalDistanceM: totalDist };
        }
        return stats;
    }

    function deg2rad(d) { return d * Math.PI / 180; }
    function escapeXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function hslToHex(h,s,l) {
        s/=100; l/=100;
        const k = n => (n + h/30) % 12;
        const a = s * Math.min(l, 1-l);
        const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
        const toHex = x => Math.round(255*f(x)).toString(16).padStart(2,'0');
        return `${toHex(0)}${toHex(8)}${toHex(4)}`;
    }
	
    // ========== ПУБЛИЧНЫЙ API ==========

	 return {
		addPoint, clearAll, clearBeacon,
		getTrack, getTrackedAddresses,
		setMaxPoints, setMinDistance,
		setShowTracks, toggleShowTracks, getSettings,
		drawTracks, exportKML, downloadKML, getStats,
		addStationPoint, clearStationTrack, drawStationTrack,
		setAnchor, getAnchor,
		get stationTrack() { return stationTrack; },
		getAll: () => tracks,
	};

})();

if (typeof module !== 'undefined' && module.exports) module.exports = TrackManager;