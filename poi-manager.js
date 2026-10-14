// poi-manager.js — Управление точками интереса (POI)

const POIManager = (() => {
    let points = []; // [{id, name, lat, lon, depth, type: 'loaded'|'marked', timestamp}]
    let nextId = 1;
    
     /**
     * Определяет разделитель CSV по первой значимой строке.
     * Поддерживает ',' (RFC 4180), ';' (русская локаль), '\t' (TSV).
     */
    function detectDelimiter(text) {
        const sample = text.split(/\r?\n/).find(l => {
            const t = l.trim();
            return t && !t.startsWith('#');
        }) || '';

        const counts = { ',': 0, ';': 0, '\t': 0 };
        let inQuotes = false;
        for (let i = 0; i < sample.length; i++) {
            const ch = sample[i];
            if (ch === '"') inQuotes = !inQuotes;
            else if (!inQuotes && (ch in counts)) counts[ch]++;
        }

        let best = ',';
        let bestN = -1;
        for (const d of [',', ';', '\t']) {
            if (counts[d] > bestN) { best = d; bestN = counts[d]; }
        }
        return best;
    }

    function loadFromCSV(text) {
        if (typeof text !== 'string' || text.length === 0) return 0;

        const delimiter = detectDelimiter(text);
        const rows = CSVUtils.parseText(text, delimiter);

        const newPoints = [];

        for (const row of rows) {
            // Пропускаем пустые и комментарии
            if (!row || row.length === 0) continue;
            const first = (row[0] || '').trim();
            if (first === '' && row.every(f => (f || '').trim() === '')) continue;
            if (first.startsWith('#')) continue;

            // Обязательные поля: имя, lat, lon
            // Пустые поля НЕ удаляются — поэтому индексы фиксированы
            if (row.length < 3) continue;

            const name = first;
            const latStr = (row[1] || '').trim();
            const lonStr = (row[2] || '').trim();
            const lat = parseFloat(latStr);
            const lon = parseFloat(lonStr);

            // Если lat/lon пустые — пропускаем запись, НЕ сдвигаем колонки
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

            const depthStr = row.length > 3 ? (row[3] || '').trim() : '';
            const depth = depthStr === '' ? NaN : parseFloat(depthStr);

            newPoints.push({
                id: nextId++,
                name: name || `POI ${nextId}`,
                lat,
                lon,
                depth: Number.isFinite(depth) ? depth : null,
                type: 'loaded',
                timestamp: Date.now()
            });
        }

        if (newPoints.length === 0) return 0;

        points = points.concat(newPoints);
        save();
        return newPoints.length;
    }
    
    function addMarkedPoint(name, lat, lon, depth) {
        points.push({
            id: nextId++,
            name: name,
            lat, lon,
            depth: !isNaN(depth) ? depth : null,
            type: 'marked',
            timestamp: Date.now()
        });
        save();
        return points[points.length - 1];
    }
    
    function removePoint(id) {
        points = points.filter(p => p.id !== id);
        save();
    }
    
    function clear() {
        points = [];
        save();
    }
    
    function getAll() { return points; }
    function getCount() { return points.length; }
    
    function save() {
        try {
            localStorage.setItem('poi_data', JSON.stringify(points));
        } catch (e) {
            console.warn('[POI] Не удалось сохранить:', e);
        }
    }
    
        function load() {
        try {
            const saved = localStorage.getItem('poi_data');
            if (!saved) return 0;

            let parsed;
            try { parsed = JSON.parse(saved); }
            catch (e) { return 0; }

            if (!Array.isArray(parsed)) return 0;

            // Валидируем каждую запись; отбрасываем мусор
            const valid = [];
            for (const raw of parsed) {
                if (!raw || typeof raw !== 'object') continue;

                const lat = Number(raw.lat);
                const lon = Number(raw.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

                const idNum = Number(raw.id);
                const depthNum = Number(raw.depth);
                const tsNum = Number(raw.timestamp);

                valid.push({
                    id: Number.isFinite(idNum) ? idNum : (valid.length + 1),
                    name: String(raw.name || `POI ${valid.length + 1}`),
                    lat,
                    lon,
                    depth: Number.isFinite(depthNum) ? depthNum : null,
                    type: raw.type === 'marked' ? 'marked' : 'loaded',
                    timestamp: Number.isFinite(tsNum) ? tsNum : Date.now()
                });
            }

            if (valid.length === 0) return 0;

            points = valid;

            // max id циклом — не через spread, чтобы не упасть на большом массиве
            let maxId = 0;
            for (const p of valid) if (p.id > maxId) maxId = p.id;
            nextId = maxId + 1;

            return valid.length;
        } catch (e) {
            console.warn('[POI] Ошибка загрузки:', e);
        }
        return 0;
    }
    
    // Инициализация
    load();
    
    return {
        loadFromCSV,
        addMarkedPoint,
        removePoint,
        clear,
        getAll,
        getCount,
        save,
        load
    };
})();