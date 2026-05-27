// log-analyzer.js — Анализ лога: маяки, компас, статистика

const LogAnalyzer = (() => {

    function analyze(entries) {
        if (!entries || entries.length === 0) return null;

        const report = {
            duration: '',
            totalEntries: entries.length,
            beacons: {},
            compass: { jumps: [], maxJump: null, gaps: [] },
            summary: {},
        };

        let firstTime = null;
        let lastTime = null;
        let prevHdg = NaN, prevHdgTime = 0;
        let prevRmcTime = 0;
        let ndtaCount = 0, gnssCount = 0, cmdCount = 0;

        for (const e of entries) {
            if (e.type === 'header') continue;

            // Временные границы
            if (e.timestamp && !firstTime) firstTime = e.timestamp;
            if (e.timestamp) lastTime = e.timestamp;

            const port = e.port || '';

            // Типы записей
            if (e.type === 'incoming' && (port === 'AZM' || port.includes('AZM'))) {
                ndtaCount++;
                if (e.data) parseNDTAForReport(e.data, report);
            } else if (e.type === 'incoming' && (port === 'GNSS' || port.includes('GNSS'))) {
                gnssCount++;
                if (e.data) parseGNSSForReport(e.data, e.timestamp, report);
            } else if (e.type === 'outgoing') {
                cmdCount++;
            }
        }

        // Длительность
        if (firstTime && lastTime) {
            const durSec = (lastTime - firstTime) / 1000;
            const m = Math.floor(durSec / 60);
            const s = Math.floor(durSec % 60);
            report.duration = `${m}м ${s}с`;
        }

        report.summary = { ndtaCount, gnssCount, cmdCount };

        // Найти скачки и потери GNSS
        report.compass.jumps = findHeadingJumps(entries, 30);
        report.compass.gaps = findGNSSGaps(entries, 5);
        
        if (report.compass.jumps.length > 0) {
            report.compass.maxJump = report.compass.jumps.reduce((a, b) => a.rate > b.rate ? a : b);
        }

        return report;
    }

    function parseNDTAForReport(data, report) {
        const parsed = AZMParser.parse(data);
        if (!parsed || parsed.type !== 'ndta') return;

        const addr = parsed.address;
        if (!report.beacons[addr]) {
            report.beacons[addr] = {
                address: addr,
                userAddress: addr + 1,
                total: 0,
                succeeded: 0,
                timeouts: 0,
                sumRange: 0,
                sumMsr: 0,
                countRange: 0,
                countMsr: 0,
            };
        }

        const b = report.beacons[addr];
        b.total++;

        if (parsed.status === 1) {
            b.succeeded++;
            if (!isNaN(parsed.slantRangeM)) {
                b.sumRange += parsed.slantRangeM;
                b.countRange++;
            }
            if (!isNaN(parsed.msrDB)) {
                b.sumMsr += parsed.msrDB;
                b.countMsr++;
            }
        } else if (parsed.status === 2) {
            b.timeouts++;
        }
    }

    function parseGNSSForReport(data, timestamp, report) {
        // Данные GNSS учитываются в findHeadingJumps/findGNSSGaps отдельно
    }

    function findHeadingJumps(entries, thresholdDegPerSec = 30) {
        let prevHdg = NaN, prevTime = 0;
        const jumps = [];

        for (const e of entries) {
            const port = e.port || '';
            if (e.type === 'incoming' && (port === 'GNSS' || port.includes('GNSS'))) {
                const gnss = GNSSParser.parse(e.data || '');
                if (gnss && (gnss.type === 'hdt' || gnss.type === 'hdm')) {
                    if (!isNaN(prevHdg) && prevTime > 0) {
                        const dt = (e.timestamp - prevTime) / 1000;
                        let dHdg = Math.abs(gnss.heading - prevHdg);
                        if (dHdg > 180) dHdg = 360 - dHdg;
                        if (dt > 0 && dHdg / dt > thresholdDegPerSec) {
                            jumps.push({
                                from: prevHdg,
                                to: gnss.heading,
                                dt: dt,
                                rate: dHdg / dt,
                                timestamp: e.timestamp,
                            });
                        }
                    }
                    prevHdg = gnss.heading;
                    prevTime = e.timestamp;
                }
            }
        }

        return jumps;
    }

    function findGNSSGaps(entries, maxGapSec = 5) {
        let prevTime = 0;
        const gaps = [];

        for (const e of entries) {
            const port = e.port || '';
            if (e.type === 'incoming' && (port === 'GNSS' || port.includes('GNSS'))) {
                const gnss = GNSSParser.parse(e.data || '');
                if (gnss && gnss.type === 'rmc') {
                    if (prevTime > 0) {
                        const gap = (e.timestamp - prevTime) / 1000;
                        if (gap > maxGapSec) {
                            gaps.push({ gapSec: gap, timestamp: e.timestamp });
                        }
                    }
                    prevTime = e.timestamp;
                }
            }
        }

        return gaps;
    }

    function formatReport(report) {
        if (!report) return 'Нет данных для анализа.';

        let html = '';

        html += `<h3>📊 Общая статистика</h3>`;
        html += `<div>Длительность: <b>${report.duration}</b></div>`;
        html += `<div>Всего записей: <b>${report.totalEntries}</b></div>`;
        html += `<div>NDTA: <b>${report.summary.ndtaCount}</b> | GNSS: <b>${report.summary.gnssCount}</b> | Команд: <b>${report.summary.cmdCount}</b></div>`;

        html += `<h3 style="margin-top:16px;">📡 Маяки</h3>`;
        if (Object.keys(report.beacons).length === 0) {
            html += `<div style="color:#888;">Нет данных маяков в логе</div>`;
        } else {
            for (const addr in report.beacons) {
                const b = report.beacons[addr];
                const pct = b.total > 0 ? (b.succeeded / b.total * 100).toFixed(1) : '0';
                const avgRange = b.countRange > 0 ? (b.sumRange / b.countRange).toFixed(1) : '--';
                const avgMsr = b.countMsr > 0 ? (b.sumMsr / b.countMsr).toFixed(1) : '--';

                html += `<div style="margin:4px 0;">`;
                html += `<b>#${b.userAddress}</b>: `;
                html += `Успешно: <b>${pct}%</b> (${b.succeeded}/${b.total}) | `;
                html += `Ср.дальность: <b>${avgRange}м</b> | `;
                html += `Ср.MSR: <b>${avgMsr}dB</b>`;
                html += `</div>`;
            }
        }

        html += `<h3 style="margin-top:16px;">🧭 Компас</h3>`;
        const jumps = report.compass.jumps || [];
        const gaps = report.compass.gaps || [];

        html += `<div>Скачков heading (>30°/с): <b>${jumps.length}</b></div>`;
        if (jumps.length > 0) {
            const max = jumps.reduce((a, b) => a.rate > b.rate ? a : b);
            html += `<div>Макс. скачок: <b>${max.from.toFixed(1)}° → ${max.to.toFixed(1)}° за ${max.dt.toFixed(2)}с (${max.rate.toFixed(0)}°/с)</b></div>`;
        }

        html += `<div style="margin-top:4px;">Потерь GNSS (>5с): <b>${gaps.length}</b></div>`;

        return html;
    }

    return {
        analyze,
        findHeadingJumps,
        findGNSSGaps,
        formatReport,
    };

})();