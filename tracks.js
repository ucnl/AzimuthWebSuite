// tracks.js — Управление треками маяков и экспорт в KML
// v5: единая система координат (метры), станция в (0,0) при отсутствии GNSS

const TrackManager = (() => {

    // ========== ХРАНИЛИЩЕ ТРЕКОВ ==========
    let tracks = {};            // { [beaconAddress]: [{ x, y, lat, lon, ... }] }
    let stationTrack = [];     // [{ x, y, lat, lon, ts }]    
	const MAX_STORED_POINTS = 50000;      // для маяков
    const MAX_STORED_STATION = 50000;     // для станции
	
	const GLOW_TAIL_POINTS = 100;

    // Якорь — первая точка станции с GNSS
    let anchorLat = NaN, anchorLon = NaN;

	// Блочная обрезка вместо shift() — амортизированно O(1)
	const TRIM_CHUNK = 5000;
	function trimArray(arr, maxLen, chunk) {
		if (arr.length > maxLen + chunk) {
			arr.splice(0, arr.length - maxLen);
		}
	}


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
		const deltas = GeoUtils.deltasByDegrees(anchorLat, anchorLon, lat, lon);
		return {
			x: deltas.deltaLonM,   // Easting
			y: deltas.deltaLatM    // Northing
		};
	}

    function getAnchor() {
        return { lat: anchorLat, lon: anchorLon };
    }

    // ========== ТРЕК СТАНЦИИ ==========

	 function addStationPoint(lat, lon, headingDeg) {
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

		stationTrack.push({ 
			x: m.x, y: m.y, 
			lat, lon, 
			ts: Date.now(),
			heading: (!isNaN(headingDeg) ? headingDeg : null)
		});
		
		//while (stationTrack.length > MAX_STORED_STATION) stationTrack.shift();
		trimArray(stationTrack, MAX_STORED_STATION, TRIM_CHUNK);
	}

    function clearStationTrack() {
        stationTrack = [];
        anchorLat = NaN;
        anchorLon = NaN;
    }

	function drawStationTrack(ctx, offsetX, offsetY, scale) {
		if (stationTrack.length < 2) return;

		const stationLine = ColorCache.get().trackStationLine;

		const drawCount = settings.maxPointsPerTrack;
		const startIdx = Math.max(0, stationTrack.length - drawCount);
		const MIN_PIXEL_DIST_SQ = 1.5 * 1.5;

		// === Основная линия ===
		ctx.beginPath();
		let first = true;
		let lastX = 0, lastY = 0;

		for (let i = startIdx; i < stationTrack.length; i++) {
			const point = stationTrack[i];
			const x = offsetX + point.x * scale;
			const y = offsetY - point.y * scale;

			if (first) {
				ctx.moveTo(x, y);
				lastX = x; lastY = y;
				first = false;
				continue;
			}

			const dx = x - lastX, dy = y - lastY;
			if (dx * dx + dy * dy < MIN_PIXEL_DIST_SQ) continue;

			ctx.lineTo(x, y);
			lastX = x; lastY = y;
		}

		if (!first) {
			ctx.strokeStyle = stationLine;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}

		// === Свечение на хвосте (последние GLOW_TAIL_POINTS точек) ===
		const glowStart = Math.max(startIdx, stationTrack.length - GLOW_TAIL_POINTS);
		if (stationTrack.length - glowStart >= 2) {
			ctx.beginPath();
			let gFirst = true;
			for (let i = glowStart; i < stationTrack.length; i++) {
				const point = stationTrack[i];
				const x = offsetX + point.x * scale;
				const y = offsetY - point.y * scale;

				if (gFirst) {
					ctx.moveTo(x, y);
					gFirst = false;
				} else {
					ctx.lineTo(x, y);
				}
			}
			if (!gFirst) {
				ctx.strokeStyle = stationLine;
				ctx.lineWidth = 7;
				ctx.globalAlpha = 0.35;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				ctx.stroke();
				ctx.globalAlpha = 1.0;
			}
		}
	}

    // ========== ТРЕКИ МАЯКОВ ==========

	function addPoint(address, dist, azm, lat, lon, dpt, isTimeout, xM, yM, zM) {
		// Принимаем точку даже без dist/azm, если есть относительные координаты
		if (isNaN(dist) && isNaN(xM)) return;

		if (!tracks[address]) {
			tracks[address] = [];
		}

		const track = tracks[address];

		// Вычисляем метры от якоря: если есть абсолютные координаты — от якоря, иначе NaN
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
				// Если есть относительные координаты — сравниваем по ним
				if (!isNaN(xM) && !isNaN(last.xM)) {
					const d = Math.sqrt((xM - last.xM) ** 2 + (yM - last.yM) ** 2);
					if (d < settings.minPointDistanceM) return;
				} else if (!isNaN(x) && !isNaN(last.x)) {
					const d = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2);
					if (d < settings.minPointDistanceM) return;
				} else if (!isNaN(dist) && !isNaN(last.dist) && !isNaN(azm) && !isNaN(last.azm)) {
					const angDiff = (azm - last.azm) * Math.PI / 180;
					const d = Math.sqrt(dist * dist + last.dist * last.dist - 2 * dist * last.dist * Math.cos(angDiff));
					if (d < settings.minPointDistanceM) return;
				}
			}
		}

		track.push({
			dist: isNaN(dist) ? null : dist,
			azm: isNaN(azm) ? null : azm,
			x, y,
			lat: !isNaN(lat) ? lat : null,
			lon: !isNaN(lon) ? lon : null,
			dpt: isNaN(dpt) ? 0 : dpt,
			ts: Date.now(),
			isTimeout: !!isTimeout,
			xM: !isNaN(xM) ? xM : null,
			yM: !isNaN(yM) ? yM : null,
			zM: !isNaN(zM) ? zM : (!isNaN(dpt) ? dpt : null),
		});

		//while (track.length > MAX_STORED_POINTS) track.shift();
		trimArray(track, MAX_STORED_POINTS, TRIM_CHUNK);
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
		// Окно отрисовки. Хранилище (MAX_STORED_POINTS = 50000) не трогаем —
		// данные для экспорта не должны зависеть от UI-настройки.
		settings.maxPointsPerTrack = Math.max(10, Math.min(MAX_STORED_POINTS, n));
	}

    function setMinDistance(m) { settings.minPointDistanceM = Math.max(0, Math.min(100, m)); }
    function setShowTracks(show) { settings.showTracks = !!show; }
    function toggleShowTracks() { settings.showTracks = !settings.showTracks; return settings.showTracks; }
    function getSettings() { return { ...settings }; }

    // ========== ОТРИСОВКА ТРЕКОВ МАЯКОВ ==========

	// ========== СВЕЧЕНИЕ ХВОСТА ТРЕКА ==========

	/**
	 * Рисует «свечение» на последних GLOW_TAIL_POINTS валидных точках трека.
	 * Пропускает isTimeout. Используется и для маяков, и (при желании) для станции.
	 *
	 * @param ctx        — CanvasRenderingContext2D
	 * @param track      — массив точек трека
	 * @param hue        — оттенок цвета маяка (0..360), для hsl(...)
	 * @param isCartesian — режим декартовых координат (xM/yM vs x/y vs dist/azm)
	 * @param offsetX, offsetY, scale — параметры карты
	 * @param startIdx   — начало окна отрисовки (ниже которого точки не рисуем)
	 */
	function drawTrackGlowTail(ctx, track, hue, isCartesian, offsetX, offsetY, scale, startIdx) {
		// 1. Находим индекс последней GLOW_TAIL_POINTS валидной точки.
		//    Идём с конца, пропуская isTimeout.
		let glowStartIdx = -1;
		let validCount = 0;

		for (let i = track.length - 1; i >= startIdx; i--) {
			const p = track[i];
			if (p.isTimeout) continue;
			validCount++;
			if (validCount === GLOW_TAIL_POINTS) {
				glowStartIdx = i;
				break;
			}
		}

		// Если валидных меньше 2 — рисовать нечего
		if (glowStartIdx < 0 || track.length - glowStartIdx < 2) return;

		// 2. Строим путь по найденным точкам (только последние N валидных).
		ctx.beginPath();
		let gFirst = true;

		for (let i = glowStartIdx; i < track.length; i++) {
			const p = track[i];
			if (p.isTimeout) continue;

			let x, y;
			if (isCartesian && p.xM === p.xM && p.yM === p.yM) {
				x = offsetX + p.xM * scale;
				y = offsetY - p.yM * scale;
			} else if (p.x === p.x) {
				x = offsetX + p.x * scale;
				y = offsetY - p.y * scale;
			} else {
				const ang = p.azm * Math.PI / 180;
				x = offsetX + p.dist * Math.sin(ang) * scale;
				y = offsetY - p.dist * Math.cos(ang) * scale;
			}

			if (gFirst) {
				ctx.moveTo(x, y);
				gFirst = false;
			} else {
				ctx.lineTo(x, y);
			}
		}

		if (!gFirst) {
			// Цвет — тот же hue, но чуть ярче, с встроенной альфой 0.35.
			// globalAlpha НЕ трогаем — иначе он перемножится с hsla(...) и получится слишком бледно.
			ctx.strokeStyle = `hsla(${hue}, 80%, 65%, 0.35)`;
			ctx.lineWidth = 8;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();
		}
	}


	function drawTracks(ctx, offsetX, offsetY, scale) {
		if (!settings.showTracks) return;

		let isCartesian = false;
		try {
			if (typeof AZMManager !== 'undefined' && AZMManager.getState) {
				isCartesian = AZMManager.getState().antennaMode === 'cartesian_fixed';
			}
		} catch (e) {}

		const trackLineAlpha = ColorCache.get().trackBeaconLineAlpha;
		const MIN_PIXEL_DIST_SQ = 1.5 * 1.5;

		for (const addr in tracks) {
			const track = tracks[addr];
			if (track.length < 2) continue;

			const hue = (parseInt(addr) * 60) % 360;
			const drawCount = settings.maxPointsPerTrack;
			const startIdx = Math.max(0, track.length - drawCount);

			// === Основная линия с decimation ===
			ctx.beginPath();
			let first = true;
			let lastX = 0, lastY = 0;

			for (let i = startIdx; i < track.length; i++) {
				const point = track[i];
				if (point.isTimeout) continue;

				let x, y;
				if (isCartesian && point.xM === point.xM && point.yM === point.yM) {
					x = offsetX + point.xM * scale;
					y = offsetY - point.yM * scale;
				} else if (point.x === point.x) {
					x = offsetX + point.x * scale;
					y = offsetY - point.y * scale;
				} else {
					const ang = point.azm * Math.PI / 180;
					x = offsetX + point.dist * Math.sin(ang) * scale;
					y = offsetY - point.dist * Math.cos(ang) * scale;
				}

				if (first) {
					ctx.moveTo(x, y);
					lastX = x; lastY = y;
					first = false;
					continue;
				}

				const dx = x - lastX, dy = y - lastY;
				if (dx * dx + dy * dy < MIN_PIXEL_DIST_SQ) continue;

				ctx.lineTo(x, y);
				lastX = x; lastY = y;
			}

			if (!first) {
				ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${trackLineAlpha})`;
				ctx.lineWidth = 3;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				ctx.stroke();
			}

			// === Свечение на хвосте ===
			drawTrackGlowTail(ctx, track, hue, isCartesian, offsetX, offsetY, scale, startIdx);
		}
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
		drawTracks, getStats,
		addStationPoint, clearStationTrack, drawStationTrack,
		setAnchor, getAnchor,
		get stationTrack() { return stationTrack; },
		getAll: () => tracks,
	};

})();

if (typeof module !== 'undefined' && module.exports) module.exports = TrackManager;