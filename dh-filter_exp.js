// dh-filter.js — ACHOD filter (Adaptive Concurring Hypotheses Outlier Detector)

const DHTrackFilter = (() => {

    class GeoPoint3DTd {
        constructor(lat, lon, dpt, ts, prevPoint = null) {
            this.lat = lat;
            this.lon = lon;
            this.dpt = dpt;
            this.ts = ts;

            if (prevPoint) {
                this.dist2Prev = haversineInverse(
                    lat, lon,
                    prevPoint.lat, prevPoint.lon,
                    Haversine.WGS84_A
                );
                this.time2Prev = (ts - prevPoint.ts) / 1000;
            } else {
                this.dist2Prev = NaN;
                this.time2Prev = NaN;
            }
        }
    }

    class DHTrackFilter {
        constructor(fifoSize = 8, maxSpeedMps = 1.0, dstThresholdM = 5.0) {
            if (fifoSize < 2) throw new Error('fifoSize must be >= 2');
            if (maxSpeedMps <= 0) throw new Error('maxSpeedMps must be > 0');
            if (dstThresholdM <= 0) throw new Error('dstThresholdM must be > 0');

            this.fifoSize = fifoSize;
            this._maxSpeedMps = maxSpeedMps;
            this.dstThreshold = dstThresholdM;

            this.sides = [[], []];
            this.pSideIdx = 0;
        }

        get sSideIdx() {
            return this.pSideIdx === 0 ? 1 : 0;
        }

        _addPoint(sideIdx, point) {
            const side = this.sides[sideIdx];
            if (side.length + 1 > this.fifoSize) {
                side.shift();
            }
            side.push(point);
        }

        // Вычисление DRMS для массива точек
        _calculateDRMS(points) {
            if (points.length < 2) return Infinity;
            
            let sumSquared = 0;
            let validCount = 0;
            
            for (let i = 1; i < points.length; i++) {
                if (!isNaN(points[i].dist2Prev)) {
                    sumSquared += Math.pow(points[i].dist2Prev, 2);
                    validCount++;
                }
            }
            
            if (validCount === 0) return Infinity;
            return Math.sqrt(sumSquared / validCount);
        }

        // Полный перебор всех комбинаций из двух очередей
        _rebuildBestHypothesis() {
            const queue0 = this.sides[0];
            const queue1 = this.sides[1];
            
            // Проверяем, заполнилась ли хотя бы одна очередь
            if (queue0.length < this.fifoSize && queue1.length < this.fifoSize) {
                return;  // недостаточно данных
            }
            
            // Получаем все уникальные точки из обеих очередей (до размера fifoSize)
            const allPoints = [];
            const timeMap = new Map();
            
            // Берём последние this.fifoSize точек из каждой очереди
            const recent0 = queue0.slice(-this.fifoSize);
            const recent1 = queue1.slice(-this.fifoSize);
            
            for (let i = 0; i < recent0.length; i++) {
                const key = recent0[i].ts.getTime();
                if (!timeMap.has(key)) {
                    timeMap.set(key, recent0[i]);
                }
            }
            for (let i = 0; i < recent1.length; i++) {
                const key = recent1[i].ts.getTime();
                if (!timeMap.has(key)) {
                    timeMap.set(key, recent1[i]);
                }
            }
            
            // Сортируем по времени
            for (let point of timeMap.values()) {
                allPoints.push(point);
            }
            allPoints.sort((a, b) => a.ts - b.ts);
            
            if (allPoints.length < this.fifoSize) return;
            
            // Генерируем все возможные комбинации длины this.fifoSize
            let bestDRMS = Infinity;
            let bestCombination = null;
            
            // Рекурсивный перебор комбинаций из allPoints длиной fifoSize
            const generateCombinations = (start, current) => {
                if (current.length === this.fifoSize) {
                    // Проверяем соблюдение максимальной скорости
                    let speedValid = true;
                    for (let i = 1; i < current.length; i++) {
                        const speed = current[i].dist2Prev / current[i].time2Prev;
                        if (speed > this._maxSpeedMps) {
                            speedValid = false;
                            break;
                        }
                    }
                    
                    if (speedValid) {
                        const drms = this._calculateDRMS(current);
                        if (drms < bestDRMS) {
                            bestDRMS = drms;
                            bestCombination = current.slice();
                        }
                    }
                    return;
                }
                
                for (let i = start; i < allPoints.length; i++) {
                    if (current.length === 0 || allPoints[i].ts > current[current.length - 1].ts) {
                        // Пересчитываем dist2Prev для новой точки
                        if (current.length > 0) {
                            const lastPoint = current[current.length - 1];
                            allPoints[i].dist2Prev = haversineInverse(
                                allPoints[i].lat, allPoints[i].lon,
                                lastPoint.lat, lastPoint.lon,
                                Haversine.WGS84_A
                            );
                            allPoints[i].time2Prev = (allPoints[i].ts - lastPoint.ts) / 1000;
                        }
                        current.push(allPoints[i]);
                        generateCombinations(i + 1, current);
                        current.pop();
                    }
                }
            };
            
            generateCombinations(0, []);
            
            // Если нашли лучшую комбинацию
            if (bestCombination !== null && bestCombination.length === this.fifoSize) {
                // Сохраняем старую основную очередь как запасную
                const oldPrimary = this.sides[this.pSideIdx];
                this.sides[this.sSideIdx] = oldPrimary;
                
                // Новая основная очередь - лучшая комбинация
                this.sides[this.pSideIdx] = bestCombination;
                
                // Очищаем запасную от дубликатов (оставляем только точки, не вошедшие в лучшую)
                const bestTimes = new Set(bestCombination.map(p => p.ts.getTime()));
                const filteredAlt = this.sides[this.sSideIdx].filter(p => !bestTimes.has(p.ts.getTime()));
                this.sides[this.sSideIdx] = filteredAlt.slice(-this.fifoSize);
            }
        }

        _updateStatistics() {
            const side0 = this.sides[0];
            const side1 = this.sides[1];

            if (side0.length !== this.fifoSize || side1.length !== this.fifoSize) {
                return;
            }

            const meanDst = [0, 0];
            for (let i = 0; i < this.fifoSize; i++) {
                meanDst[0] += side0[i].dist2Prev;
                meanDst[1] += side1[i].dist2Prev;
            }
            meanDst[0] /= this.fifoSize;
            meanDst[1] /= this.fifoSize;

            const sigmas = [0, 0];
            for (let i = 0; i < this.fifoSize; i++) {
                sigmas[0] += Math.pow(side0[i].dist2Prev - meanDst[0], 2);
                sigmas[1] += Math.pow(side1[i].dist2Prev - meanDst[1], 2);
            }
            sigmas[0] = Math.sqrt(sigmas[0]);
            sigmas[1] = Math.sqrt(sigmas[1]);

            if (sigmas[this.sSideIdx] < sigmas[this.pSideIdx]) {
                this.pSideIdx = this.sSideIdx;
            }
        }
		
		get maxSpeedMps() {
			return this._maxSpeedMps;
		}
		
		set maxSpeedMps(value) {
			if (value > 0) {
				this._maxSpeedMps = value;
			}
		}
		
		setFifoSize(newSize) {
			if (newSize < 2) return;
			if (newSize === this.fifoSize) return;
			
			this.fifoSize = newSize;
			
			for (let i = 0; i < 2; i++) {
				while (this.sides[i].length > this.fifoSize) {
					this.sides[i].shift();
				}
			}
		}

        process(lat, lon, dpt, ts) {
            const primary = this.sides[this.pSideIdx];

            if (primary.length === 0) {
                const point = new GeoPoint3DTd(lat, lon, dpt, ts);
                this._addPoint(this.pSideIdx, point);
                return { accepted: true, lat, lon, dpt, ts };
            }

            this._updateStatistics();

            const lastPoint = primary[primary.length - 1];
            const testPoint = new GeoPoint3DTd(lat, lon, dpt, ts, lastPoint);

            const speedOk = testPoint.dist2Prev < testPoint.time2Prev * this._maxSpeedMps;
            const thresholdOk = testPoint.dist2Prev < this.dstThreshold;

            if (speedOk || thresholdOk) {
                this._addPoint(this.pSideIdx, testPoint);
                
                // Если основная очередь заполнилась - запускаем оптимизацию
                if (primary.length >= this.fifoSize) {
                    this._rebuildBestHypothesis();
                }
                
                return { accepted: true, lat, lon, dpt, ts };
            } else {
                const altSide = this.sides[this.sSideIdx];
                const altLastPoint = altSide.length > 0 ? altSide[altSide.length - 1] : null;
                const altPoint = new GeoPoint3DTd(lat, lon, dpt, ts, altLastPoint);
                this._addPoint(this.sSideIdx, altPoint);
                
                // Если запасная очередь заполнилась - запускаем оптимизацию
                if (altSide.length >= this.fifoSize) {
                    this._rebuildBestHypothesis();
                }
                
                return { accepted: false, lat: NaN, lon: NaN, dpt: NaN, ts: null };
            }
        }

        reset() {
            this.sides = [[], []];
            this.pSideIdx = 0;
        }
    }

    window.DHTrackFilter = DHTrackFilter;
    return DHTrackFilter;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DHTrackFilter;
}