 // azm-manager.js — Конвейер обработки данных Zima2 USBL

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
	const DEFAULT_USBL_DH_THRESHOLD_FAR = 200.0;       // дальность > 3000 м
	const DEFAULT_USBL_DH_THRESHOLD_MEDIUM = 100.0;    // дальность 1500–3000 м
	const DEFAULT_USBL_DH_THRESHOLD_NEAR = 15.0;       // дальность 500–1500 м
	const DEFAULT_USBL_DH_FAR_LIMIT = 3000.0;          // граница "далеко"
	const DEFAULT_USBL_DH_MEDIUM_LIMIT = 1500.0;       // граница "средне"
	const DEFAULT_USBL_DH_NEAR_LIMIT = 500.0;          // граница "близко"
	const DEFAULT_USBL_S_FIFO = 4;
	const DEFAULT_USBL_S_THRESHOLD = 100.0;
	const DEFAULT_SOUND_SPEED_MPS = 1480.0;
	
	const DEFAULT_ACHOD_FIFO = 8;
	const DEFAULT_ACHOD_MAX_AZIMUTH_RATE_DPS = 5.0;
	const DEFAULT_ACHOD_MIN_SECTOR_WIDTH_DEG = 8.0;
	const DEFAULT_ACHOD_SENSOR_NOISE_FACTOR = 3.0;
	const DEFAULT_ACHOD_MAX_RANGE_CHANGE_M = 10.0;
	
	// === режим опорных маяков ===
	const DEFAULT_REF_SHIP_MAX_AGE_MS = 20000;   // 20 сек — время жизни позиции судна
	const DEFAULT_REF_MAX_SPREAD_M = 50.0;       // макс. разброс между опорными
	
	// === НОВОЕ: DH-фильтр позиции судна ===
	const DEFAULT_SHIP_DH_THRESHOLD = 8.0;      // порог DH-фильтра судна (м)
	const DEFAULT_MAX_SHIP_SPEED_MPS = 2.0;     // макс. скорость судна (м/с)

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
		antennaMode: 'geographic', // 'geographic' | 'cartesian_fixed'
		// GNSS-позиция (справочно, для диагностики и сравнения)
		gnssLatDeg: NaN, gnssLonDeg: NaN, gnssTimestamp: 0,
		isInterrogationActive: false, isDeviceInfoValid: false,
		deviceType: 0, serialNumber: '',
		beacons: {}, lastUpdateTime: 0,
		referenceBeacons: {},        // { [addr]: { lat, lon, depth } }
		refShipMaxAgeMs: DEFAULT_REF_SHIP_MAX_AGE_MS,
		refMaxSpreadM: DEFAULT_REF_MAX_SPREAD_M,
		shipPosition: null,          // { lat, lon, ts, count, spread, sourceAddr }
		shipPositionsBuffer: {},     // { [addr]: { lat, lon, ts } }
		// DH-фильтр позиции судна (один на все опорные маяки)
		shipDHFilter: null,
		maxShipSpeedMps: DEFAULT_MAX_SHIP_SPEED_MPS,
		rejectedShipPosition: null,   // { lat, lon, ts } — последняя отвергнутая позиция
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
                dhFilter: null, smoother: null, smootherXYZ: null, achodFilter: null, lastNDTA: null,
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

	/**
	 * Диспетчер: общая подготовка данных + вызов стратегии по режиму.
	 * Стратегии: strategyCartesianFixed, strategyGeographic.
	 * Поведение идентично старой монолитной processBeaconData.
	 */
	function processBeaconData(ndata) {
		try {
			if (isNaN(ndata.propTimeS) || ndata.propTimeS <= 0) {
				if (!isNaN(ndata.hAngleDeg)) {
					const beacon = getOrCreateBeacon(ndata.address);
					beacon.azimuthDeg = ndata.hAngleDeg;
					return beacon;
				}
				return null;
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

			if (!isNaN(ndata.resCode) && ndata.resCode >= 500) {
				if (!isNaN(ndata.hAngleDeg)) {
					beacon.azimuthDeg = state.antennaCorrector.correctAngle(ndata.hAngleDeg);
				}
				return beacon;
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
					projectionM = beacon.slantRangeM;
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

			// === ДИСПЕТЧЕРИЗАЦИЯ ПО РЕЖИМУ ===
			if (state.antennaMode === 'cartesian_fixed') {
				return strategyCartesianFixed(beacon, projectionM, hasProjection);
			}

			if (state.antennaMode === 'beacon_referenced') {
				return strategyBeaconReferenced(beacon, projectionM, hasProjection);
			}

			// По умолчанию — географический (с внутренними fallback'ами)
			return strategyGeographic(beacon, projectionM, hasProjection);

		} catch (e) {
			console.error('[AZM Manager] Ошибка:', e.message);
			return null;
		}
	}

	/**
	 * Стратегия: декартов режим (неподвижная антенна).
	 * X → вправо (East), Y → вперёд (North), Z → вниз (глубина).
	 * Использует DHTrackFilterXYZ + TrackMedianFilterXYZ.
	 */
	function strategyCartesianFixed(beacon, projectionM, hasProjection) {
		if (!hasProjection || isNaN(beacon.azimuthDeg)) {
			return beacon;
		}

		const azmRad = deg2rad(beacon.azimuthDeg);
		const distXY = projectionM;

		const xM = distXY * Math.sin(azmRad);  // +X = вправо
		const yM = distXY * Math.cos(azmRad);  // +Y = вперёд
		const zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;

		if (!beacon.dhFilterXYZ && window.DHTrackFilterXYZ) {
			beacon.dhFilterXYZ = new DHTrackFilterXYZ(
				DEFAULT_USBL_DH_FIFO,
				state.maxBeaconSpeedMps || 1.0,
				DEFAULT_USBL_DH_THRESHOLD
			);
		}

		if (beacon.dhFilterXYZ) {
			// Адаптивные пороги по дистанции
			if (!isNaN(distXY)) {
				if (distXY > 3000) {
					beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_FAR;
					beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
				} else if (distXY > 1500) {
					beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_MEDIUM;
					beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
				} else if (distXY > 500) {
					beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_NEAR;
					beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO);
				} else {
					beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD;
					beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO);
				}
			}

			if (beacon.dhFilterXYZ.maxSpeedMps !== state.maxBeaconSpeedMps) {
				beacon.dhFilterXYZ.maxSpeedMps = state.maxBeaconSpeedMps;
			}

			const now = timeProvider();
			const dhResult = beacon.dhFilterXYZ.process(xM, yM, zM, now);

			if (dhResult.accepted) {
				beacon.absoluteAzimuthDeg = beacon.azimuthDeg;
				beacon.absoluteDistanceM = distXY;

				// Сглаживатель (только до 1000 м)
				if (distXY <= 1000.0) {
					if (!beacon.smootherXYZ && window.TrackMedianFilterXYZ) {
						beacon.smootherXYZ = new TrackMedianFilterXYZ(
							DEFAULT_USBL_S_FIFO,
							DEFAULT_USBL_S_THRESHOLD
						);
					}
					if (beacon.smootherXYZ) {
						const smoothResult = beacon.smootherXYZ.process(dhResult.x, dhResult.y, dhResult.z, now);
						beacon.xM = smoothResult.x;
						beacon.yM = smoothResult.y;
						beacon.zM = smoothResult.z;
					} else {
						beacon.xM = dhResult.x;
						beacon.yM = dhResult.y;
						beacon.zM = dhResult.z;
					}
				} else {
					beacon.xM = dhResult.x;
					beacon.yM = dhResult.y;
					beacon.zM = dhResult.z;
				}

				// Географические координаты — NaN
				beacon.latitudeDeg = NaN;
				beacon.longitudeDeg = NaN;

			} else {
				// Точка отвергнута
				beacon.rejectedXM = xM;
				beacon.rejectedYM = yM;
				beacon.rejectedZM = zM;
				beacon.rejectedDistanceM = distXY;
				beacon.rejectedAzimuthDeg = beacon.azimuthDeg;
			}
		}

		return beacon;
	}

	/**
	 * Стратегия: географический режим.
	 * Основная логика — если есть координаты антенны (lat/lon/heading).
	 * Fallback 1 — "только heading" (ACHOD-фильтр), если координат антенны нет.
	 * Fallback 2 — только reverseAzimuthDeg, если нет и heading.
	 */
	function strategyGeographic(beacon, projectionM, hasProjection) {
		// === ОСНОВНАЯ ЛОГИКА: есть координаты антенны ===
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
				return beacon;
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
					beacon.absoluteAzimuthDeg = polarResult.a_deg;
					beacon.absoluteDistanceM = absRange;
					beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);

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
						beacon.latitudeDeg = rad2deg(geoResult.lat);
						beacon.longitudeDeg = rad2deg(geoResult.lon);
					}
				} else {
					beacon.rejectedLatitudeDeg = rad2deg(geoResult.lat);
					beacon.rejectedLongitudeDeg = rad2deg(geoResult.lon);
					beacon.rejectedDistanceM = absRange;
					beacon.rejectedAzimuthDeg = polarResult.a_deg;
				}
			} else {
				beacon.absoluteAzimuthDeg = polarResult.a_deg;
				beacon.absoluteDistanceM = absRange;
				beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
				beacon.latitudeDeg = rad2deg(geoResult.lat);
				beacon.longitudeDeg = rad2deg(geoResult.lon);
			}

			return beacon;
		}

		// === FALLBACK 1: "только heading" (координат антенны нет, но heading есть) ===
		if (hasProjection && !isNaN(beacon.azimuthDeg) && !isNaN(state.antennaHeadingDeg)) {

			const distForFilter = projectionM;

			if (!beacon.achodFilter && window.ACHODBearingFilter) {
				beacon.achodFilter = new ACHODBearingFilter(
					DEFAULT_USBL_DH_FIFO,   // fifoSize
					5.0,                     // maxAzimuthRateDps
					8.0,                     // minSectorWidthDeg
					3.0,                     // sensorNoiseFactor
					10.0                     // maxRangeChangeM
				);
			}

			if (beacon.achodFilter) {
				const accepted = beacon.achodFilter.process(
					state.antennaHeadingDeg,
					beacon.azimuthDeg,
					distForFilter,
					timeProvider()
				);

				if (accepted) {
					const f = beacon.achodFilter.lastFiltered;
					// absoluteAzimuthDeg здесь — АБСОЛЮТНЫЙ азимут (heading + relative bearing)
					beacon.absoluteAzimuthDeg = f.azimuthDeg;
					beacon.absoluteDistanceM = f.rangeM;
					beacon.reverseAzimuthDeg = wrap360(f.azimuthDeg + 180);

					// Географических координат нет — позиция антенны неизвестна
					beacon.latitudeDeg = NaN;
					beacon.longitudeDeg = NaN;
				} else {
					beacon.rejectedAzimuthDeg = wrap360(state.antennaHeadingDeg + beacon.azimuthDeg);
					beacon.rejectedDistanceM = distForFilter;
				}
			} else {
				// Fallback: фильтр недоступен — просто абсолютный азимут
				beacon.absoluteAzimuthDeg = wrap360(state.antennaHeadingDeg + beacon.azimuthDeg);
				beacon.absoluteDistanceM = distForFilter;
				beacon.reverseAzimuthDeg = wrap360(beacon.absoluteAzimuthDeg + 180);
				beacon.latitudeDeg = NaN;
				beacon.longitudeDeg = NaN;
			}

			return beacon;
		}

		// === FALLBACK 2: только reverseAzimuthDeg ===
		if (!isNaN(beacon.azimuthDeg)) {
			beacon.reverseAzimuthDeg = wrap360(beacon.azimuthDeg + 180);
		}

		return beacon;
	}
	
	/**
	 * Стратегия: режим опорных маяков.
	 * Опорный маяк (address ∈ state.referenceBeacons) → вычисляем позицию судна.
	 * Искомый маяк → вычисляем координаты от позиции судна.
	 * 
	 * offsets (offsetX/offsetY) НЕ применяем — только phi.
	 * antennaDepthM НЕ трогаем — свой датчик давления.
	 */
	function strategyBeaconReferenced(beacon, projectionM, hasProjection) {
		if (!hasProjection || isNaN(beacon.azimuthDeg) || isNaN(state.antennaHeadingDeg)) {
			return beacon;
		}

		// Абсолютный азимут и дальность — БЕЗ offsets, только phi
		const polarResult = polarCS_Rotate(
			state.antennaHeadingDeg, state.phiDeg,
			beacon.azimuthDeg, projectionM
		);
		const absRange = polarResult.r_a;

		// === СЛУЧАЙ 1: это опорный маяк → вычисляем позицию судна ===
		if (state.referenceBeacons[beacon.address]) {
			const ref = state.referenceBeacons[beacon.address];

			// Обратная задача: от опорного маяка к судну
			const reverseAzmRad = deg2rad(wrap360(polarResult.a_deg + 180));
			const shipGeo = directGeodetic(
				deg2rad(ref.lat),
				deg2rad(ref.lon),
				reverseAzmRad,
				absRange
			);

			if (isNaN(shipGeo.lat) || isNaN(shipGeo.lon)) {
				return beacon;
			}

			const now = timeProvider().getTime ? timeProvider().getTime() : Date.now();
			
			// ВАЖНО: DHTrackFilter работает в РАДИАНАХ.
			// shipGeo.lat/lon — уже радианы (возврат directGeodetic).
			// Для буфера и rejected используем ГРАДУСЫ.
			const shipLatRad = shipGeo.lat;
			const shipLonRad = shipGeo.lon;
			const shipLatDeg = rad2deg(shipGeo.lat);
			const shipLonDeg = rad2deg(shipGeo.lon);

			// === DH-ФИЛЬТР позиции судна (один на все опорные маяки) ===
			if (!state.shipDHFilter && DHTrackFilter) {
				state.shipDHFilter = new DHTrackFilter(
					DEFAULT_USBL_DH_FIFO,
					state.maxShipSpeedMps || DEFAULT_MAX_SHIP_SPEED_MPS,
					DEFAULT_SHIP_DH_THRESHOLD
				);
			}

			let acceptedLatRad = shipLatRad;
			let acceptedLonRad = shipLonRad;

			if (state.shipDHFilter) {
				// Синхронизируем maxSpeed с настройками
				if (state.shipDHFilter.maxSpeedMps !== state.maxShipSpeedMps) {
					state.shipDHFilter.maxSpeedMps = state.maxShipSpeedMps;
				}

				// Передаём РАДИАНЫ
				const dhResult = state.shipDHFilter.process(shipLatRad, shipLonRad, 0, now);

				if (dhResult.accepted) {
					acceptedLatRad = dhResult.lat;
					acceptedLonRad = dhResult.lon;
					state.rejectedShipPosition = null;
				} else {
					// Отвергнуто — сохраняем в ГРАДУСАХ для отрисовки
					state.rejectedShipPosition = { lat: shipLatDeg, lon: shipLonDeg, ts: now };
					// Координаты опорного маяка всё равно обновим
					beacon.latitudeDeg = ref.lat;
					beacon.longitudeDeg = ref.lon;
					beacon.absoluteAzimuthDeg = polarResult.a_deg;
					beacon.absoluteDistanceM = absRange;
					beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
					return beacon;
				}
			}

			// Пишем в буфер — переводим РАДИАНЫ → ГРАДУСЫ
			state.shipPositionsBuffer[beacon.address] = {
				lat: rad2deg(acceptedLatRad),
				lon: rad2deg(acceptedLonRad),
				ts: now,
			};

			// Пересчёт средней позиции
			recalculateShipPosition();

			// Обновляем виртуальную позицию антенны (только lat/lon, без depth)
			if (state.shipPosition) {
				state.antennaLatDeg = state.shipPosition.lat;
				state.antennaLonDeg = state.shipPosition.lon;
			}

			// Координаты опорного маяка = известные
			beacon.latitudeDeg = ref.lat;
			beacon.longitudeDeg = ref.lon;
			beacon.absoluteAzimuthDeg = polarResult.a_deg;
			beacon.absoluteDistanceM = absRange;
			beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);

			return beacon;
		}

		// === СЛУЧАЙ 2: искомый маяк, позиция судна известна ===
		if (!isNaN(state.antennaLatDeg) && !isNaN(state.antennaLonDeg)) {
			const absAzmRad = deg2rad(polarResult.a_deg);
			const geoResult = directGeodetic(
				deg2rad(state.antennaLatDeg),
				deg2rad(state.antennaLonDeg),
				absAzmRad,
				absRange
			);

			if (isNaN(geoResult.lat) || isNaN(geoResult.lon)) {
				return beacon;
			}

			// DH-фильтр на координаты маяка
			if (!beacon.dhFilter && DHTrackFilter) {
				const currentMaxSpeed = (state.maxBeaconSpeedMps > 0) ? state.maxBeaconSpeedMps : 1.0;
				beacon.dhFilter = new DHTrackFilter(DEFAULT_USBL_DH_FIFO, currentMaxSpeed, DEFAULT_USBL_DH_THRESHOLD);
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
				const dhResult = beacon.dhFilter.process(
					geoResult.lat, geoResult.lon,
					!isNaN(beacon.depthM) ? beacon.depthM : 0,
					now
				);

				if (dhResult.accepted) {
					beacon.absoluteAzimuthDeg = polarResult.a_deg;
					beacon.absoluteDistanceM = absRange;
					beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);

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
							const smoothResult = beacon.smoother.process(
								geoResult.lat, geoResult.lon,
								!isNaN(beacon.depthM) ? beacon.depthM : 0,
								now
							);
							beacon.latitudeDeg = rad2deg(smoothResult.lat);
							beacon.longitudeDeg = rad2deg(smoothResult.lon);
						} else {
							beacon.latitudeDeg = rad2deg(geoResult.lat);
							beacon.longitudeDeg = rad2deg(geoResult.lon);
						}
					} else {
						beacon.latitudeDeg = rad2deg(geoResult.lat);
						beacon.longitudeDeg = rad2deg(geoResult.lon);
					}
				} else {
					beacon.rejectedLatitudeDeg = rad2deg(geoResult.lat);
					beacon.rejectedLongitudeDeg = rad2deg(geoResult.lon);
					beacon.rejectedDistanceM = absRange;
					beacon.rejectedAzimuthDeg = polarResult.a_deg;
				}
			} else {
				beacon.absoluteAzimuthDeg = polarResult.a_deg;
				beacon.absoluteDistanceM = absRange;
				beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
				beacon.latitudeDeg = rad2deg(geoResult.lat);
				beacon.longitudeDeg = rad2deg(geoResult.lon);
			}

			return beacon;
		}

		// === СЛУЧАЙ 3: искомый маяк, позиции судна ещё нет ===
		beacon.absoluteAzimuthDeg = polarResult.a_deg;
		beacon.absoluteDistanceM = absRange;
		beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
		beacon.latitudeDeg = NaN;
		beacon.longitudeDeg = NaN;
		return beacon;
	}

	/**
	 * Пересчёт средней позиции судна по буферу опорных маяков.
	 * Вызывается при каждом новом измерении опорного.
	 * 
	 * Логика:
	 * - Отбрасываем записи старше refShipMaxAgeMs
	 * - Если 1 источник — берём его
	 * - Если >1 — считаем медиану по lat/lon и разброс
	 * - Если разброс > refMaxSpreadM — берём последнюю запись
	 */
	function recalculateShipPosition() {
		const now = timeProvider().getTime ? timeProvider().getTime() : Date.now();
		const maxAge = state.refShipMaxAgeMs;
		const valid = [];

		for (const addr in state.shipPositionsBuffer) {
			const p = state.shipPositionsBuffer[addr];
			if (now - p.ts < maxAge) {
				valid.push(p);
			}
		}

		if (valid.length === 0) {
			state.shipPosition = null;
			return;
		}

		if (valid.length === 1) {
			state.shipPosition = {
				lat: valid[0].lat,
				lon: valid[0].lon,
				ts: now,
				updatedAt: Date.now(),
				count: 1,
				spread: 0,
			};
			return;
		}

		// Разброс — максимальное попарное расстояние
		// valid[i].lat/lon — в ГРАДУСАХ, haversineInverse ждёт РАДИАНЫ
		let spread = 0;
		for (let i = 0; i < valid.length; i++) {
			for (let j = i + 1; j < valid.length; j++) {
				const d = Haversine.haversineInverse(
					deg2rad(valid[i].lat), deg2rad(valid[i].lon),
					deg2rad(valid[j].lat), deg2rad(valid[j].lon)
				);
				if (d > spread) spread = d;
			}
		}

		if (spread > state.refMaxSpreadM) {
			// Слишком большой разброс — берём последнюю
			const last = valid[valid.length - 1];
			state.shipPosition = {
				lat: last.lat,
				lon: last.lon,
				ts: now,
				updatedAt: Date.now(), 
				count: valid.length,
				spread: spread,
			};
			return;
		}

		// Медиана по lat/lon
		const lat = median(valid.map(p => p.lat));
		const lon = median(valid.map(p => p.lon));

		state.shipPosition = {
			lat, lon,
			ts: now,
			updatedAt: Date.now(), 
			count: valid.length,
			spread,
		};
	}

	/**
	 * Медиана массива чисел.
	 */
	function median(arr) {
		if (arr.length === 0) return NaN;
		const sorted = arr.slice().sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2
			? sorted[mid]
			: (sorted[mid - 1] + sorted[mid]) / 2;
	}	
	
	
	
	
	
	function resetShipTracking() {
		state.shipPosition = null;
		state.shipPositionsBuffer = {};
		state.shipDHFilter = null;
		state.rejectedShipPosition = null;
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

	/**
	 * Упрощённая полярная коррекция — без смещений (offsetX/offsetY).
	 * Используется в режиме beacon_referenced: только phi и heading.
	 */
	function polarCS_Rotate(hdg, phi, bng, rM) {
		const teta = wrap2PI(deg2rad(bng + phi));
		const xr = rM * Math.sin(teta);
		const yr = rM * Math.cos(teta);
		let a_r = Math.atan2(xr, yr);
		if (a_r < 0) a_r += 2 * Math.PI;
		a_r += deg2rad(hdg);
		a_r = wrap2PI(a_r);
		return { a_deg: rad2deg(a_r), r_a: rM };
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
			case 'rsts':
				return { type: 'rsts', data: parsed };
			case 'ack':
				return { type: 'ack', data: parsed };
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
	function setAntennaHeading(headingDeg) { state.antennaHeadingDeg = headingDeg;	}
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
	function setAntennaMode(mode) {
		if (mode !== 'geographic' && mode !== 'cartesian_fixed' && mode !== 'beacon_referenced') {
			return;
		}
		if (state.antennaMode === mode) return;
		
		state.antennaMode = mode;
		
		// При выходе из beacon_referenced — сбрасываем виртуальную позицию, фильтр и отвергнутую
		if (mode !== 'beacon_referenced') {
			state.shipPosition = null;
			state.shipPositionsBuffer = {};
			state.shipDHFilter = null;
			state.rejectedShipPosition = null;
		}
	}

	/**
	 * Устанавливает GNSS-позицию (справочно).
	 * НЕ влияет на antennaLatDeg/LonDeg — только для диагностики и сравнения.
	 */
	function setGnssPosition(latDeg, lonDeg) {
		if (!isNaN(latDeg) && !isNaN(lonDeg)) {
			state.gnssLatDeg = latDeg;
			state.gnssLonDeg = lonDeg;
			state.gnssTimestamp = Date.now();
		}
	}
	
	/**
	 * Устанавливает максимальную скорость судна (м/с).
	 * Используется в DH-фильтре позиции судна.
	 */
	function setMaxShipSpeed(mps) {
		if (!isNaN(mps) && mps >= 0.5 && mps <= 50) {
			state.maxShipSpeedMps = mps;
			if (state.shipDHFilter) {
				state.shipDHFilter.maxSpeedMps = mps;
			}
		}
	}


	// === НОВОЕ: опорные маяки ===
	function setReferenceBeacon(addr, lat, lon, depth) {
		if (isNaN(addr) || isNaN(lat) || isNaN(lon)) return;
		state.referenceBeacons[addr] = {
			lat: lat,
			lon: lon,
			depth: isNaN(depth) ? 0 : depth
		};
	}

	function removeReferenceBeacon(addr) {
		delete state.referenceBeacons[addr];
		delete state.shipPositionsBuffer[addr];
		recalculateShipPosition();
	}

	function clearReferenceBeacons() {
		state.referenceBeacons = {};
		state.shipPositionsBuffer = {};
		state.shipPosition = null;
	}

	function setRefShipMaxAge(ms) {
		if (!isNaN(ms) && ms > 0) state.refShipMaxAgeMs = ms;
	}

	function setRefMaxSpread(m) {
		if (!isNaN(m) && m > 0) state.refMaxSpreadM = m;
	}





    function recalcAllBeacons() {
        if (state.antennaMode === 'beacon_referenced') {
            // Проход 1: опорные маяки - обновляем позицию судна
            for (const addr in state.beacons) {
                if (!state.referenceBeacons[addr]) continue;
                if (state.beacons[addr].lastNDTA) {
                    processBeaconData(state.beacons[addr].lastNDTA);
                }
            }
            // Проход 2: остальные маяки - вычисляем координаты от позиции судна
            for (const addr in state.beacons) {
                if (state.referenceBeacons[addr]) continue;
                if (state.beacons[addr].lastNDTA) {
                    processBeaconData(state.beacons[addr].lastNDTA);
                }
            }
        } else {
            // Старое поведение для geographic / cartesian_fixed
            for (const addr in state.beacons) {
                if (state.beacons[addr].lastNDTA) processBeaconData(state.beacons[addr].lastNDTA);
            }
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
        setAntennaPosition, setAntennaHeading, setSalinity, setMaxDistance, setSoundSpeed, 
		setGnssPosition,
		setSoundSpeedAuto,
        setAddressMask, setAntennaOffsets, setMaxBeaconSpeed,
		setAntennaMode,
        recalcAllBeacons,
        getState, getBeacons, getBeaconsArray, tickAge, reset,
        DEFAULT_SOUND_SPEED_MPS,
		setSpeedCourse,
		loadAntennaCalibration,
		resetAntennaCalibration,
		isAntennaCalibrated,
		setTimeProvider: (fn) => { timeProvider = fn; },
		// === НОВОЕ: опорные маяки ===
		setReferenceBeacon,
		removeReferenceBeacon,
		clearReferenceBeacons,
		setRefShipMaxAge,
		setRefMaxSpread,
		setMaxShipSpeed,
		resetShipTracking,
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AZMManager;