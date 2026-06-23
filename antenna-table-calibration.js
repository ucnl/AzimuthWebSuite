// antenna-table-calibration.js — Построение калибровочной таблицы антенны

const AntennaTableCalibration = (() => {

    let points = [];
    let centroidLat = NaN;
    let centroidLon = NaN;
    let calibrationTable = null;
    
    let angleStep = 1.0;
    let smoothWindow = 5;
    let minPointsPerSector = 3;

    function init() {
        reset();
    }

    function reset() {
        points = [];
        centroidLat = NaN;
        centroidLon = NaN;
        calibrationTable = null;
    }

    function addPoint(headingDeg, measuredAzimuthDeg, slantRangeM, 
                      antennaLatDeg, antennaLonDeg, antennaDepthM, beaconDepthM) {
        
        const phiDeg = 0;
        const offsetXM = 0;
        const offsetYM = 0;
        
        const polarResult = polarCS_ShiftRotate(
            headingDeg, phiDeg,
            measuredAzimuthDeg, slantRangeM,
            offsetXM, offsetYM
        );
        
        const absAzimuthDeg = polarResult.a_deg;
        const absRangeM = polarResult.r_a;
        
        const latRad = Vincenty.deg2rad(antennaLatDeg);
        const lonRad = Vincenty.deg2rad(antennaLonDeg);
        const azmRad = Vincenty.deg2rad(absAzimuthDeg);
        
        const geoResult = directGeodetic(latRad, lonRad, azmRad, absRangeM);
        
        points.push({
            antennaLatDeg,
            antennaLonDeg,
            headingDeg,
            measuredAzimuthDeg,
            slantRangeM,
            beaconLatDeg: Vincenty.rad2deg(geoResult.lat),
            beaconLonDeg: Vincenty.rad2deg(geoResult.lon),
            absAzimuthDeg,
            absRangeM,
            antennaDepthM,
            beaconDepthM
        });
    }

    function getCount() { return points.length; }

    function computeCentroid() {
        if (points.length < 5) {
            return { lat: NaN, lon: NaN, count: 0 };
        }
        
        let sumLat = 0, sumLon = 0;
        let validCount = 0;
        
        for (const pt of points) {
            if (!isNaN(pt.beaconLatDeg) && !isNaN(pt.beaconLonDeg)) {
                sumLat += pt.beaconLatDeg;
                sumLon += pt.beaconLonDeg;
                validCount++;
            }
        }
        
        if (validCount < 3) {
            return { lat: NaN, lon: NaN, count: validCount };
        }
        
        centroidLat = sumLat / validCount;
        centroidLon = sumLon / validCount;
        
        return {
            lat: centroidLat,
            lon: centroidLon,
            count: validCount
        };
    }

	function buildTable(stepDeg = 1.0) {
		angleStep = stepDeg;
		
		if (isNaN(centroidLat) || isNaN(centroidLon)) {
			computeCentroid();
		}
		
		if (isNaN(centroidLat) || isNaN(centroidLon)) {
			return { encoderAngles: [], errors: [], coverage: 0 };
		}
		
		const errorPoints = [];
		
		for (const pt of points) {
			if (isNaN(pt.antennaLatDeg) || isNaN(pt.antennaLonDeg)) continue;
			
			// Вычисляем абсолютный пеленг от антенны на центроиду
			const deltas = GeoUtils.deltasByDegrees(
				pt.antennaLatDeg, pt.antennaLonDeg,
				centroidLat, centroidLon
			);
			
			let trueAzimuthDeg = Math.atan2(deltas.deltaLonM, deltas.deltaLatM) * 180 / Math.PI;
			if (trueAzimuthDeg < 0) trueAzimuthDeg += 360;
			
			// Ожидаемый ОТНОСИТЕЛЬНЫЙ пеленг (что должна показать идеальная антенна)
			let expectedRelativeBearing = trueAzimuthDeg - pt.headingDeg;
			// Нормализуем в [0, 360)
			expectedRelativeBearing = ((expectedRelativeBearing % 360) + 360) % 360;
			
			// Ошибка антенны: что она показала минус что должна была показать
			let error = pt.measuredAzimuthDeg - expectedRelativeBearing;
			
			// Нормализуем ошибку в [-180, 180]
			while (error > 180) error -= 360;
			while (error < -180) error += 360;
			
			// Ключевой угол для таблицы — measuredAzimuth (угол энкодера)
			let encoderAngle = pt.measuredAzimuthDeg % 360;
			if (encoderAngle < 0) encoderAngle += 360;
			
			errorPoints.push({
				encoderAngle: encoderAngle,
				error: error,
				trueAzimuth: trueAzimuthDeg,
				expectedRelative: expectedRelativeBearing,
				measured: pt.measuredAzimuthDeg,
				heading: pt.headingDeg
			});
		}
		
		const numSectors = Math.ceil(360 / angleStep);
		const sectors = new Array(numSectors).fill(null).map(() => ({
			errors: [],
			center: 0
		}));
		
		for (let i = 0; i < numSectors; i++) {
			sectors[i].center = i * angleStep + angleStep / 2;
		}
		
		for (const ep of errorPoints) {
			let sectorIndex = Math.floor(ep.encoderAngle / angleStep);
			if (sectorIndex < 0) sectorIndex = 0;
			if (sectorIndex >= numSectors) sectorIndex = numSectors - 1;
			sectors[sectorIndex].errors.push(ep.error);
		}
		
		// Собираем сектора — просто усредняем ошибки внутри каждого
		const rawAngles = [];
		const rawErrors = [];
		
		for (let i = 0; i < numSectors; i++) {
			const sector = sectors[i];
			if (sector.errors.length >= minPointsPerSector) {
				const avgError = sector.errors.reduce((a, b) => a + b, 0) / sector.errors.length;
				rawAngles.push(sector.center);
				rawErrors.push(avgError);
			}
		}
		
		if (rawAngles.length < 2) {
			const sectorsWithData = sectors.filter(s => s.errors.length > 0).length;
			alert(`Недостаточно данных.\nСекторов с данными: ${sectorsWithData}/${numSectors}\n` +
				  `Секторов с >=${minPointsPerSector} точками: ${rawAngles.length}\n` +
				  `Попробуйте увеличить шаг угла или уменьшить мин. точек`);
			return { encoderAngles: [], errors: [], coverage: 0 };
		}
		
		// Сортируем по углу
		const combined = rawAngles.map((a, i) => ({ angle: a, error: rawErrors[i] }));
		combined.sort((a, b) => a.angle - b.angle);
		
		const coverage = rawAngles.length / numSectors;
		
		calibrationTable = {
			encoderAngles: combined.map(c => c.angle),
			errors: combined.map(c => c.error),
			coverage: coverage,
			centroidLat: centroidLat,
			centroidLon: centroidLon,
			totalPoints: points.length,
			usedSectors: rawAngles.length,
			totalSectors: numSectors
		};
		
		return calibrationTable;
	}


    function polarCS_ShiftRotate(hdg, phi, bng, rM, xt, yt) {
        const teta = Vincenty.wrap2PI(Vincenty.deg2rad(bng + phi));
        const xr = xt + rM * Math.sin(teta);
        const yr = yt + rM * Math.cos(teta);
        let a_r = Math.atan2(xr, yr);
        if (a_r < 0) a_r += 2 * Math.PI;
        a_r += Vincenty.deg2rad(hdg);
        a_r = Vincenty.wrap2PI(a_r);
        return {
            a_deg: Vincenty.rad2deg(a_r),
            r_a: Math.sqrt(xr * xr + yr * yr),
        };
    }

    function directGeodetic(latRad, lonRad, azmRad, distM) {
        const v = Vincenty.vincentyDirect(latRad, lonRad, azmRad, distM);
        return v.converged ? v : Haversine.haversineDirect(latRad, lonRad, distM, azmRad);
    }

    function exportCSV() {
        if (!calibrationTable || !calibrationTable.encoderAngles.length) return '';
        return AntennaCorrector.formatToText(
            calibrationTable.encoderAngles,
            calibrationTable.errors
        );
    }

    function downloadCSV(filename) {
        if (!calibrationTable || !calibrationTable.encoderAngles.length) {
            alert('Нет данных для скачивания');
            return;
        }
        AntennaCorrector.downloadCalibrationFile(
            calibrationTable.encoderAngles,
            calibrationTable.errors,
            filename || 'antenna_table_calibration.csv'
        );
    }

    function applyToManager() {
        if (!calibrationTable || !calibrationTable.encoderAngles.length) return false;
        AZMManager.loadAntennaCalibration(
            calibrationTable.encoderAngles,
            calibrationTable.errors
        );
        return true;
    }

    function getState() {
        return {
            pointCount: points.length,
            hasCentroid: !isNaN(centroidLat) && !isNaN(centroidLon),
            centroidLat,
            centroidLon,
            hasTable: calibrationTable !== null && calibrationTable.encoderAngles.length > 0,
            coverage: calibrationTable ? calibrationTable.coverage : 0,
            usedSectors: calibrationTable ? calibrationTable.usedSectors : 0,
            totalSectors: calibrationTable ? calibrationTable.totalSectors : 0,
            angleStep,
            smoothWindow
        };
    }

    function setAngleStep(step) { angleStep = Math.max(0.1, Math.min(10, step)); }
    function setSmoothWindow(window) { smoothWindow = Math.max(1, Math.min(20, window)); }
	
	/**
	 * Экспортирует сырые данные и таблицу в CSV для анализа
	 */
	function exportFullData() {
		if (!calibrationTable || points.length === 0) {
			alert('Нет данных для экспорта');
			return;
		}
		
		const lines = [];
		
		// Заголовок
		lines.push('# Antenna Calibration Full Data');
		lines.push(`# Centroid: ${centroidLat.toFixed(8)}, ${centroidLon.toFixed(8)}`);
		lines.push(`# Total points: ${points.length}`);
		lines.push(`# Sectors: ${calibrationTable.usedSectors}/${calibrationTable.totalSectors}`);
		lines.push(`# Coverage: ${(calibrationTable.coverage * 100).toFixed(1)}%`);
		lines.push(`# Angle step: ${angleStep}°`);
		lines.push('#');
		
		// Заголовки колонок сырых данных
		lines.push('# RAW DATA:');
		lines.push('index,antennaLat,antennaLon,heading,measuredAzimuth,slantRange,beaconLat,beaconLon,trueAzimuth,expectedRelative,error');
		
		// Вычисляем ошибки для каждой точки (как в buildTable)
		for (let i = 0; i < points.length; i++) {
			const pt = points[i];
			if (isNaN(pt.antennaLatDeg) || isNaN(pt.antennaLonDeg)) continue;
			
			const deltas = GeoUtils.deltasByDegrees(
				pt.antennaLatDeg, pt.antennaLonDeg,
				centroidLat, centroidLon
			);
			
			let trueAzimuthDeg = Math.atan2(deltas.deltaLonM, deltas.deltaLatM) * 180 / Math.PI;
			if (trueAzimuthDeg < 0) trueAzimuthDeg += 360;
			
			let expectedRelativeBearing = trueAzimuthDeg - pt.headingDeg;
			expectedRelativeBearing = ((expectedRelativeBearing % 360) + 360) % 360;
			
			let error = pt.measuredAzimuthDeg - expectedRelativeBearing;
			while (error > 180) error -= 360;
			while (error < -180) error += 360;
			
			lines.push([
				i,
				pt.antennaLatDeg.toFixed(8),
				pt.antennaLonDeg.toFixed(8),
				pt.headingDeg.toFixed(2),
				pt.measuredAzimuthDeg.toFixed(2),
				pt.slantRangeM.toFixed(2),
				pt.beaconLatDeg.toFixed(8),
				pt.beaconLonDeg.toFixed(8),
				trueAzimuthDeg.toFixed(4),
				expectedRelativeBearing.toFixed(4),
				error.toFixed(6)
			].join(','));
		}
		
		// Заголовки таблицы
		lines.push('');
		lines.push('# CALIBRATION TABLE:');
		lines.push('encoderAngle,error');
		
		for (let i = 0; i < calibrationTable.encoderAngles.length; i++) {
			lines.push([
				calibrationTable.encoderAngles[i].toFixed(3),
				calibrationTable.errors[i].toFixed(6)
			].join(','));
		}
		
		return lines.join('\n');
	}

	/**
	 * Скачивает полный отчёт
	 */
	function downloadFullData(filename) {
		const text = exportFullData();
		if (!text) return;
		
		filename = filename || 'antenna_calibration_full_' + new Date().toISOString().slice(0, 10) + '.csv';
		const blob = new Blob([text], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

    init();

    return {
        reset,
        addPoint,
        getCount,
        computeCentroid,
        buildTable,
        exportCSV,
		exportFullData,
        downloadCSV,
		downloadFullData,
        applyToManager,
        getState,
        setAngleStep,
        setSmoothWindow,
        get calibrationTable() { return calibrationTable; }
    };

})();