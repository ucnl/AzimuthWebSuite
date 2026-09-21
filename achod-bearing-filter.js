// achod-bearing-filter.js — ACHODBearingFilter
// Портировано с C# UCNLNav.TrackFilters.ACHODBearingFilter
// Работает в пространстве абсолютных азимутов (heading + relative bearing).
// Использует две конкурирующие гипотезы траектории и автоматически выбирает лучшую.

const ACHODBearingFilter = (() => {

    // ========== BearingPoint3DTd ==========
    class BearingPoint3DTd {
        constructor(azimuth_deg, range_m, ts, arg4, arg5) {
            this.azimuthDeg = azimuth_deg;
            this.rangeM = range_m;
            this.ts = ts;

            if (arg4 instanceof BearingPoint3DTd) {
                // Конструктор от предыдущей точки
                const prev = arg4;
                this.azimuthDeltaDeg = BearingPoint3DTd.angularDifference(azimuth_deg, prev.azimuthDeg);
                this.rangeDeltaM = Math.abs(range_m - prev.rangeM);
            } else if (typeof arg4 === 'number') {
                // Явные дельты
                this.azimuthDeltaDeg = arg4;
                this.rangeDeltaM = arg5;
            } else {
                // Без дельт
                this.azimuthDeltaDeg = NaN;
                this.rangeDeltaM = NaN;
            }
        }

        static angularDifference(deg1, deg2) {
            let diff = Math.abs(deg1 - deg2) % 360.0;
            return diff > 180.0 ? 360.0 - diff : diff;
        }
    }

    // ========== ACHODBearingFilter ==========
    const DEFAULTS = {
        MAX_AZIMUTH_RATE_DPS: 5.0,
        MIN_SECTOR_WIDTH_DEG: 8.0,
        SENSOR_NOISE_FACTOR: 3.0,
        MAX_RANGE_CHANGE_M: 10.0,
        FIFO_SIZE: 8,
    };

    class ACHODBearingFilter {
        constructor(fifoSize = DEFAULTS.FIFO_SIZE,
                    maxAzimuthRateDps = DEFAULTS.MAX_AZIMUTH_RATE_DPS,
                    minSectorWidthDeg = DEFAULTS.MIN_SECTOR_WIDTH_DEG,
                    sensorNoiseFactor = DEFAULTS.SENSOR_NOISE_FACTOR,
                    maxRangeChangeM = DEFAULTS.MAX_RANGE_CHANGE_M) {
            if (fifoSize < 2) throw new Error('fifoSize must be >= 2');
            if (maxAzimuthRateDps <= 0) throw new Error('maxAzimuthRateDps must be > 0');
            if (minSectorWidthDeg <= 0) throw new Error('minSectorWidthDeg must be > 0');
            if (sensorNoiseFactor <= 0) throw new Error('sensorNoiseFactor must be > 0');
            if (maxRangeChangeM <= 0) throw new Error('maxRangeChangeM must be > 0');

            this.fifoSize = fifoSize;
            this.maxAzimuthRateDps = maxAzimuthRateDps;
            this.minSectorWidthDeg = minSectorWidthDeg;
            this.sensorNoiseFactor = sensorNoiseFactor;
            this.maxRangeChangeM = maxRangeChangeM;

            this.primarySide = [];
            this.secondarySide = [];
            this.pSideIdx = 1;  // 1 = primary активна, 2 = secondary активна

            // Последний принятый/отклонённый результат (для удобства вызывающего кода)
            this.lastFiltered = { accepted: false, azimuthDeg: NaN, rangeM: NaN };
        }

        get isPrimaryActive() { return this.pSideIdx === 1; }
        get primarySideCount() { return this.primarySide.length; }
        get secondarySideCount() { return this.secondarySide.length; }

        _addPoint(side, point) {
            if (side.length + 1 > this.fifoSize) side.shift();
            side.push(point);
        }

        _predictSector(side, currentTime, out) {
            if (side.length < 2) {
                out.centerDeg = side[side.length - 1].azimuthDeg;
                out.halfWidthDeg = this.minSectorWidthDeg;
                return;
            }

            const nPts = Math.min(4, side.length);
            const rates = [];
            for (let k = side.length - nPts + 1; k < side.length; k++) {
                const dt = (side[k].ts - side[k - 1].ts) / 1000;
                if (dt > 0) {
                    const rate = BearingPoint3DTd.angularDifference(
                        side[k].azimuthDeg, side[k - 1].azimuthDeg) / dt;
                    rates.push(rate);
                }
            }

            let estRate = 0.0;
            if (rates.length > 0) {
                rates.sort((a, b) => a - b);
                estRate = rates[Math.floor(rates.length / 2)];
                estRate = Math.min(estRate, this.maxAzimuthRateDps);
            }

            const dt2Pred = (currentTime - side[side.length - 1].ts) / 1000;
            let centerDeg = (side[side.length - 1].azimuthDeg + estRate * dt2Pred) % 360.0;
            if (centerDeg < 0) centerDeg += 360.0;

            const dynamicWidth = estRate * dt2Pred * 1.5;
            const noiseWidth = this.sensorNoiseFactor;
            const halfWidthDeg = Math.max(this.minSectorWidthDeg, dynamicWidth + noiseWidth);

            out.centerDeg = centerDeg;
            out.halfWidthDeg = halfWidthDeg;
        }

        _inSector(azimuth_deg, center_deg, halfWidth_deg) {
            return BearingPoint3DTd.angularDifference(azimuth_deg, center_deg) <= halfWidth_deg;
        }

        _rangeConfidence(range_m, side) {
            if (side.length < 3) return 0.5;

            const nPts = Math.min(5, side.length);
            let sum = 0, sumSq = 0;
            for (let k = side.length - nPts; k < side.length; k++) {
                sum += side[k].rangeM;
                sumSq += side[k].rangeM * side[k].rangeM;
            }
            const mean = sum / nPts;
            const variance = sumSq / nPts - mean * mean;
            const std = variance > 0 ? Math.sqrt(variance) : 0;

            if (std < 0.5) {
                const z = Math.abs(range_m - mean) / Math.max(std, 0.1);
                return Math.exp(-z * z / 2.0);
            }
            return 0.3;
        }

        _calculateSigma(side) {
            if (side.length < 2) return Number.MAX_VALUE;

            let mean = 0;
            for (let i = 0; i < side.length; i++) mean += side[i].azimuthDeltaDeg;
            mean /= side.length;

            let sumSq = 0;
            for (let i = 0; i < side.length; i++) {
                const d = side[i].azimuthDeltaDeg - mean;
                sumSq += d * d;
            }
            return Math.sqrt(sumSq);
        }

        reset() {
            this.primarySide = [];
            this.secondarySide = [];
            this.pSideIdx = 1;
            this.lastFiltered = { accepted: false, azimuthDeg: NaN, rangeM: NaN };
        }

        /**
         * Обработка одного измерения.
         * @param {number} heading_deg — курс антенны (магнитометр), 0–360
         * @param {number} relativeBearing_deg — пеленг на маяк относительно антенны, 0–360
         * @param {number} range_m — наклонная дальность, м
         * @param {Date} timestamp
         * @returns {boolean} true если точка принята, false если отклонена
         * После вызова this.lastFiltered содержит {accepted, azimuthDeg, rangeM}
         */
        process(heading_deg, relativeBearing_deg, range_m, timestamp) {
            let azimuthDeg = (heading_deg + relativeBearing_deg) % 360.0;
            if (azimuthDeg < 0) azimuthDeg += 360.0;

            const activeSide = this.pSideIdx === 1 ? this.primarySide : this.secondarySide;

            if (activeSide.length === 0) {
                const newPoint = new BearingPoint3DTd(azimuthDeg, range_m, timestamp);
                this._addPoint(activeSide, newPoint);
                this.lastFiltered = { accepted: true, azimuthDeg, rangeM: range_m };
                return true;
            }

            const lastRange = activeSide[activeSide.length - 1].rangeM;
            const rangeOk = Math.abs(range_m - lastRange) < this.maxRangeChangeM;

            const sector = { centerDeg: 0, halfWidthDeg: 0 };
            this._predictSector(activeSide, timestamp, sector);
            const azimuthOk = this._inSector(azimuthDeg, sector.centerDeg, sector.halfWidthDeg);

            const rangeConf = this._rangeConfidence(range_m, activeSide);

            let shouldAccept;
            if (azimuthOk) {
                shouldAccept = true;
            } else if (!azimuthOk && rangeOk && rangeConf > 0.7) {
                shouldAccept = false;
            } else if (!azimuthOk && !rangeOk) {
                shouldAccept = false;
            } else {
                const azimuthDev = BearingPoint3DTd.angularDifference(azimuthDeg, sector.centerDeg);
                shouldAccept = azimuthDev < sector.halfWidthDeg * 1.5;
            }

            if (shouldAccept) {
                let newPoint;
                if (this.primarySide.length > 0) {
                    const lastPrimary = this.primarySide[this.primarySide.length - 1];
                    newPoint = new BearingPoint3DTd(azimuthDeg, range_m, timestamp, lastPrimary);
                } else {
                    newPoint = new BearingPoint3DTd(azimuthDeg, range_m, timestamp);
                }
                this._addPoint(this.primarySide, newPoint);
                this.lastFiltered = { accepted: true, azimuthDeg, rangeM: range_m };
            } else {
                let newPoint;
                if (this.secondarySide.length > 0) {
                    const lastSecondary = this.secondarySide[this.secondarySide.length - 1];
                    newPoint = new BearingPoint3DTd(azimuthDeg, range_m, timestamp, lastSecondary);
                } else {
                    newPoint = new BearingPoint3DTd(azimuthDeg, range_m, timestamp);
                }
                this._addPoint(this.secondarySide, newPoint);
                this.lastFiltered = { accepted: false, azimuthDeg: NaN, rangeM: NaN };
            }

            // Переключение активной стороны, если накопилось достаточно данных
            if (this.primarySide.length === this.fifoSize && this.secondarySide.length === this.fifoSize) {
                const sigmaPrimary = this._calculateSigma(this.primarySide);
                const sigmaSecondary = this._calculateSigma(this.secondarySide);

                if (this.pSideIdx === 1 && sigmaSecondary < sigmaPrimary) {
                    this.pSideIdx = 2;
                } else if (this.pSideIdx === 2 && sigmaPrimary < sigmaSecondary) {
                    this.pSideIdx = 1;
                }
            }

            return shouldAccept;
        }
    }

    // Экспорт в глобальную область
    window.ACHODBearingFilter = ACHODBearingFilter;

    return ACHODBearingFilter;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ACHODBearingFilter;
}