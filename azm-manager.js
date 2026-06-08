 // azm-manager.js — Конвейер обработки данных Zima2 USBL
// ФИНАЛЬНАЯ ВЕРСИЯ БЕЗ ЛОГОВ

const AZMManager = (() => {
	
	const isUseMedian = 1;

    // ========== ГЛОБАЛЬНЫЕ ЗАВИСИМОСТИ ==========
    const DHTrackFilter = window.DHTrackFilter;
    const TrackMovingAverageSmoother = window.TrackMovingAverageSmoother;
    const vincentyDirect = Vincenty.vincentyDirect;
    const haversineDirect = Haversine.haversineDirect;
    const deg2rad = Vincenty.deg2rad;
    const rad2deg = Vincenty.rad2deg;
    const wrap2PI = Vincenty.wrap2PI;

	// ========== КОНСТАНТЫ ==========
	const DEFAULT_USBL_DH_FIFO = 8;
	const DEFAULT_USBL_DH_FIFO_FAR = 4;
	const DEFAULT_USBL_DH_THRESHOLD = 5.0;
	const DEFAULT_USBL_DH_THRESHOLD_FAR = 200.0;      // дальность > 3000 м
	const DEFAULT_USBL_DH_THRESHOLD_MEDIUM = 100.0;    // дальность 1500–3000 м
	const DEFAULT_USBL_DH_THRESHOLD_NEAR = 15.0;      // дальность 500–1500 м
	const DEFAULT_USBL_DH_FAR_LIMIT = 3000.0;          // граница "далеко"
	const DEFAULT_USBL_DH_MEDIUM_LIMIT = 1500.0;       // граница "средне"
	const DEFAULT_USBL_DH_NEAR_LIMIT = 500.0;          // граница "близко"
	const DEFAULT_USBL_S_FIFO = 4;
	const DEFAULT_USBL_S_THRESHOLD = 100.0;
	const DEFAULT_SOUND_SPEED_MPS = 1480.0;

    // ========== СОСТОЯНИЕ ==========
    let state = {
        antennaLatDeg: NaN, antennaLonDeg: NaN, antennaHeadingDeg: NaN,
        antennaPitchDeg: NaN, antennaRollDeg: NaN, antennaDepthM: NaN,
        waterTempC: NaN, pressureMBar: NaN,
		speedMps: NaN, courseDeg: NaN,
        salinityPSU: 0.0, soundSpeedMps: NaN, maxDistM: 1000.0, addressMask: 1,
		soundSpeedAuto: true,
        phiDeg: 0.0, offsetXM: 0.0, offsetYM: 0.0,
		maxBeaconSpeedMps: 1.0,
        isInterrogationActive: false, isDeviceInfoValid: false,
        deviceType: 0, serialNumber: '',
        beacons: {}, lastUpdateTime: 0,
		antennaCorrector: new AntennaCorrector.AZMAntennaCorrector(),
    };

    let timeProvider = () => new Date();

    // ========== СОСТОЯНИЕ МАЯКА ==========
    function getOrCreateBeacon(address) {
        if (!state.beacons[address]) {
            state.beacons[address] = {
                address, userAddress: address + 1,
                slantRangeM: NaN, slantRangeProjectionM: NaN,
                azimuthDeg: NaN, elevationDeg: NaN,
                depthM: NaN, msrDB: NaN, propTimeS: NaN,
                absoluteAzimuthDeg: NaN, absoluteDistanceM: NaN,
                reverseAzimuthDeg: NaN, latitudeDeg: NaN, longitudeDeg: NaN,
				vccV: NaN, waterTempC: NaN,
                isTimeout: false, dataAge: 0, succeededRequests: 0, timeouts: 0,
                dhFilter: null, smoother: null, lastNDTA: null,
            };
        }
        return state.beacons[address];
    }
	
	function setSpeedCourse(speedMps, courseDeg) {
		state.speedMps = speedMps;
		state.courseDeg = courseDeg;
	}

    // ========== ОБРАБОТКА СТАНЦИИ ==========
    function processStationData(ndata) {
        if (!isNaN(ndata.locTempC)) state.waterTempC = ndata.locTempC;
        if (!isNaN(ndata.locPressureMBar)) {
            state.pressureMBar = ndata.locPressureMBar;
            if (!isNaN(state.waterTempC)) {
                const pAtm = 1013.25, rho = 1000.0, g = 9.81;
                state.antennaDepthM = (state.pressureMBar - pAtm) * 100 / (rho * g);
                if (state.antennaDepthM < 0) state.antennaDepthM = 0;
            }
        }
        if (!isNaN(ndata.locPitchDeg)) state.antennaPitchDeg = ndata.locPitchDeg;
        if (!isNaN(ndata.locRollDeg)) state.antennaRollDeg = ndata.locRollDeg;
        if (!isNaN(ndata.locHeadingDeg)) state.antennaHeadingDeg = ndata.locHeadingDeg;
		
		// ВЫЧИСЛЕНИЕ СКОРОСТИ ЗВУКА
		if (state.soundSpeedAuto && !isNaN(state.waterTempC) && !isNaN(state.salinityPSU) && state.salinityPSU > 0) {
			state.soundSpeedMps = SoundSpeed.calc(
				state.waterTempC, 
				state.salinityPSU, 
				state.antennaDepthM || 0
			);
		}
		
		
        state.lastUpdateTime = Date.now();
    }

    // ========== ОБРАБОТКА ДАННЫХ МАЯКА ==========
	 function processBeaconData(ndata) {
		try {
			
			if (isNaN(ndata.propTimeS) || ndata.propTimeS <= 0) {
				if (!isNaN(ndata.hAngleDeg)) beacon.azimuthDeg = ndata.hAngleDeg;
				return beacon;
			}
			
			const beacon = getOrCreateBeacon(ndata.address);
			beacon.lastNDTA = ndata;

			if (!isNaN(ndata.msrDB)) beacon.msrDB = ndata.msrDB;
			if (!isNaN(ndata.remoteDepthM)) beacon.depthM = ndata.remoteDepthM;
			if (!isNaN(ndata.propTimeS)) beacon.propTimeS = ndata.propTimeS;
			if (!isNaN(ndata.hAngleDeg)) beacon.azimuthDeg = state.antennaCorrector.correctAngle(ndata.hAngleDeg);
			if (!isNaN(ndata.vAngleDeg)) beacon.elevationDeg = ndata.vAngleDeg;
			if (!isNaN(ndata.slantRangeM) && ndata.slantRangeM > 0.001) beacon.slantRangeM = ndata.slantRangeM;
			if (!isNaN(ndata.slantRangeProjectionM) && ndata.slantRangeProjectionM > 0.001) beacon.slantRangeProjectionM = ndata.slantRangeProjectionM;
			
			if (!isNaN(ndata.reqCode) && !isNaN(ndata.resCode)) {
				const ABS_MAX_VCC_V = 30.0;
				const ABS_MIN_VCC_V = 0.0;
				const ABS_MAX_TEMP_C = 80.0;
				const ABS_MIN_TEMP_C = -10.0;
				const CRANGE = 499;
				
				if (ndata.reqCode === 1) {
					beacon.waterTempC = ndata.resCode * (ABS_MAX_TEMP_C - ABS_MIN_TEMP_C) / CRANGE + ABS_MIN_TEMP_C;
				} else if (ndata.reqCode === 2) {
					beacon.vccV = ndata.resCode * (ABS_MAX_VCC_V - ABS_MIN_VCC_V) / CRANGE + ABS_MIN_VCC_V;
				}
			}

			beacon.isTimeout = false;
			beacon.succeededRequests++;
			beacon.dataAge = 0;

			let hasProjection = false;
			let projectionM = NaN;

			if (!isNaN(beacon.propTimeS)) {
				const sos = (state.soundSpeedMps > 0) ? state.soundSpeedMps : DEFAULT_SOUND_SPEED_MPS;				
				
				beacon.slantRangeM = beacon.propTimeS * sos;
				if (!isNaN(state.antennaDepthM) && !isNaN(beacon.depthM)) {
					projectionM = slantRangeProjection(state.antennaDepthM, beacon.depthM, beacon.slantRangeM);
					beacon.slantRangeProjectionM = projectionM;
					hasProjection = !isNaN(projectionM);
				} else {
					beacon.slantRangeProjectionM = beacon.slantRangeM;
					hasProjection = true;
				}
			} else if (!isNaN(beacon.slantRangeProjectionM) && beacon.slantRangeProjectionM > 0) {
				projectionM = beacon.slantRangeProjectionM;
				hasProjection = true;
			} else if (!isNaN(beacon.slantRangeM) && beacon.slantRangeM > 0) {
				projectionM = beacon.slantRangeM;
				beacon.slantRangeProjectionM = projectionM;
				hasProjection = true;
			}

			if (hasProjection && !isNaN(beacon.azimuthDeg) &&
				!isNaN(state.antennaLatDeg) && !isNaN(state.antennaLonDeg) &&
				!isNaN(state.antennaHeadingDeg)) {

				const polarResult = polarCS_ShiftRotate(
					state.antennaHeadingDeg, state.phiDeg,
					beacon.azimuthDeg, projectionM,
					state.offsetXM, state.offsetYM
				);
				const absRange = polarResult.r_a;

				if (!beacon.dhFilter && DHTrackFilter) {
					const currentMaxSpeed = (state.maxBeaconSpeedMps > 0) ? state.maxBeaconSpeedMps : 1.0;
					beacon.dhFilter = new DHTrackFilter(DEFAULT_USBL_DH_FIFO, currentMaxSpeed, DEFAULT_USBL_DH_THRESHOLD);
				}

				const latRad = deg2rad(state.antennaLatDeg);
				const lonRad = deg2rad(state.antennaLonDeg);
				const absAzmRad = deg2rad(polarResult.a_deg);
				const geoResult = directGeodetic(latRad, lonRad, absAzmRad, absRange);
				
				if (isNaN(geoResult.lat) || isNaN(geoResult.lon)) {
					return beacon;  // прерываем, не портим фильтр
				}

				if (beacon.dhFilter) {
					const distForThreshold = hasProjection ? projectionM : beacon.slantRangeM;
					if (!isNaN(distForThreshold)) {
						if (distForThreshold > 3000) {
							beacon.dhFilter.dstThreshold = 150;
							beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
						} else if (distForThreshold > 1500) {
							beacon.dhFilter.dstThreshold = 50;
							beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
						} else if (distForThreshold > 500) {
							beacon.dhFilter.dstThreshold = 15;
							beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO);
						} else {
							beacon.dhFilter.dstThreshold = DEFAULT_USBL_DH_THRESHOLD;
							beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO);
						}
					}
					
					if (beacon.dhFilter.maxSpeedMps !== state.maxBeaconSpeedMps) {
						beacon.dhFilter.maxSpeedMps = state.maxBeaconSpeedMps;
					}
					
					const now = timeProvider();
					const dhResult = beacon.dhFilter.process(geoResult.lat, geoResult.lon, !isNaN(beacon.depthM) ? beacon.depthM : 0, now);
						
					if (dhResult.accepted) {
						// Обновляем абсолютные координаты только если фильтр принял точку
						beacon.absoluteAzimuthDeg = polarResult.a_deg;
						beacon.absoluteDistanceM = absRange;
						beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
						
						// Сглаживатель — только на дистанциях до 1000 м
						const distForSmoother = hasProjection ? projectionM : beacon.slantRangeM;
						const useSmoother = !isNaN(distForSmoother) && distForSmoother <= 1000.0;
						
						if (useSmoother) {
							if (!beacon.smoother && TrackMovingAverageSmoother) {
								if (isUseMedian == 1)
									beacon.smoother = new TrackMedianFilter(DEFAULT_USBL_S_FIFO, DEFAULT_USBL_S_THRESHOLD);
								else
									beacon.smoother = new TrackMovingAverageSmoother(DEFAULT_USBL_S_FIFO, DEFAULT_USBL_S_THRESHOLD);
							}
							if (beacon.smoother) {
								const smoothResult = beacon.smoother.process(geoResult.lat, geoResult.lon,
									!isNaN(beacon.depthM) ? beacon.depthM : 0, now);
								beacon.latitudeDeg = rad2deg(smoothResult.lat);
								beacon.longitudeDeg = rad2deg(smoothResult.lon);
							} else {
								beacon.latitudeDeg = rad2deg(geoResult.lat);
								beacon.longitudeDeg = rad2deg(geoResult.lon);
							}
						} else {
							// Дальше 1000 м — без сглаживателя, сразу координаты
							beacon.latitudeDeg = rad2deg(geoResult.lat);
							beacon.longitudeDeg = rad2deg(geoResult.lon);
						}
					} else {
						// Точка отвергнута — сохраняем измеренные значения для отрисовки серым
						beacon.rejectedLatitudeDeg = rad2deg(geoResult.lat);
						beacon.rejectedLongitudeDeg = rad2deg(geoResult.lon);
						beacon.rejectedDistanceM = absRange;
						beacon.rejectedAzimuthDeg = polarResult.a_deg;
					}
				} else {
					// Нет фильтра — используем как есть
					beacon.absoluteAzimuthDeg = polarResult.a_deg;
					beacon.absoluteDistanceM = absRange;
					beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
					beacon.latitudeDeg = rad2deg(geoResult.lat);
					beacon.longitudeDeg = rad2deg(geoResult.lon);
				}
			} else if (!isNaN(beacon.azimuthDeg)) {
				beacon.reverseAzimuthDeg = wrap360(beacon.azimuthDeg + 180);
			}

			return beacon;
		} catch (e) {
			console.error('[AZM Manager] Ошибка:', e.message);
			return null;
		}
	}

    function processBeaconTimeout(address) {
        const beacon = getOrCreateBeacon(address);
        beacon.isTimeout = true;
        beacon.timeouts++;
        return beacon;
    }

	 function processNDTA(ndata) {
		processStationData(ndata);
		let beacon = null;
		if (ndata.status === 1) {
			beacon = processBeaconData(ndata);
		} else if (ndata.status === 2) {
			beacon = processBeaconTimeout(ndata.address);
		}
		return { stationUpdated: true, beacon };
	}

    // ========== МАТЕМАТИКА ==========
    function slantRangeProjection(dAnt, dBcn, sRange) {
        const dd = Math.abs(dAnt - dBcn);
        return dd < sRange ? Math.sqrt(sRange * sRange - dd * dd) : sRange;
    }

    function polarCS_ShiftRotate(hdg, phi, bng, rM, xt, yt) {
        const teta = wrap2PI(deg2rad(bng + phi));
        const xr = xt + rM * Math.sin(teta), yr = yt + rM * Math.cos(teta);
        let a_r = Math.atan2(xr, yr); if (a_r < 0) a_r += 2 * Math.PI;
        a_r += deg2rad(hdg); a_r = wrap2PI(a_r);
        return { a_deg: rad2deg(a_r), r_a: Math.sqrt(xr * xr + yr * yr) };
    }

    function directGeodetic(latRad, lonRad, azmRad, distM) {
        const v = vincentyDirect(latRad, lonRad, azmRad, distM);
        return v.converged ? v : haversineDirect(latRad, lonRad, distM, azmRad);
    }

    function wrap360(a) { let r = a % 360; return r < 0 ? r + 360 : r; }

    // ========== ВХОДНЫЕ ДАННЫЕ ==========
    function processParsedMessage(parsed) {
        if (!parsed) return null;
        switch (parsed.type) {
            case 'ndta': {
                const r = processNDTA(parsed);
                return { type: 'ndta_result', stationUpdated: true, beacon: r.beacon, raw: parsed };
            }
            case 'dinfo':
                state.deviceType = parsed.deviceType;
                state.serialNumber = parsed.serialNumber;
                state.isDeviceInfoValid = true;
                return { type: 'dinfo', data: parsed };
            case 'strstp':
                state.isInterrogationActive = (parsed.addrMask !== 0);
                return { type: 'strstp', data: parsed };
            default: return null;
        }
    }

    function processRawLine(rawLine) {
        const parsed = AZMParser.parse(rawLine);
        return processParsedMessage(parsed);
    }

    // ========== КАЛИБРОВОЧНАЯ ТАБЛИЦА ==========
	
	function loadAntennaCalibration(angles, errors) {
		state.antennaCorrector.loadCalibration(angles, errors);
	}

	function resetAntennaCalibration() {
		state.antennaCorrector.reset();
	}

	function isAntennaCalibrated() {
		return state.antennaCorrector.isCalibrated;
	}


    // ========== КОМАНДЫ ==========
    function getDINFOCommand() { return AZMParser.buildDINFO_GET(); }
    function getStartCommand() { return AZMParser.buildSTRSTP(state.addressMask, state.salinityPSU, state.soundSpeedMps, state.maxDistM); }
    function getStopCommand() { return AZMParser.buildBaseStop(); }

    // ========== НАСТРОЙКИ ==========
    function setAntennaPosition(latDeg, lonDeg, headingDeg) { state.antennaLatDeg = latDeg; state.antennaLonDeg = lonDeg; state.antennaHeadingDeg = headingDeg; }
    function setSalinity(psu) { state.salinityPSU = psu; }
    function setMaxDistance(m) { state.maxDistM = m; }
    function setSoundSpeed(mps) { state.soundSpeedMps = mps; }
	function setSoundSpeedAuto(auto) { state.soundSpeedAuto = !!auto; }
    function setAddressMask(mask) { state.addressMask = mask; }
    function setAntennaOffsets(xM, yM, phiDeg) { state.offsetXM = xM; state.offsetYM = yM; state.phiDeg = phiDeg; }
	function setMaxBeaconSpeed(maxSpeedMps) {
    if (!isNaN(maxSpeedMps) && maxSpeedMps >= 0.5 && maxSpeedMps <= 5) {
        state.maxBeaconSpeedMps = maxSpeedMps;
        // Обновляем скорость во всех существующих фильтрах маяков
        for (var addr in state.beacons) {
            if (state.beacons.hasOwnProperty(addr)) {
                var beacon = state.beacons[addr];
                if (beacon.dhFilter) {
                    beacon.dhFilter.maxSpeedMps = maxSpeedMps;
                }
            }
        }
    }
}

    function recalcAllBeacons() {
        for (const addr in state.beacons) {
            if (state.beacons[addr].lastNDTA) processBeaconData(state.beacons[addr].lastNDTA);
        }
    }

    function tickAge() {
        for (const addr in state.beacons) state.beacons[addr].dataAge++;
    }

    function getState() { return state; }
    function getBeacons() { return state.beacons; }
    function getBeaconsArray() { return Object.values(state.beacons); }

    function reset() {
        for (const addr in state.beacons) delete state.beacons[addr];
        state.lastUpdateTime = 0;
    }

    return {
        processRawLine, processParsedMessage, processNDTA,
        getDINFOCommand, getStartCommand, getStopCommand,
        setAntennaPosition, setSalinity, setMaxDistance, setSoundSpeed,
		setSoundSpeedAuto,
        setAddressMask, setAntennaOffsets, setMaxBeaconSpeed,
        recalcAllBeacons,
        getState, getBeacons, getBeaconsArray, tickAge, reset,
        DEFAULT_SOUND_SPEED_MPS,
		setSpeedCourse,
		loadAntennaCalibration,
		resetAntennaCalibration,
		isAntennaCalibrated,
		setTimeProvider: (fn) => { timeProvider = fn; },
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AZMManager;