// modules/ui-topo.js
// Управление ручной топопривязкой (координаты антенны)
// Поддерживает режимы: 'full' (lat/lon/курс) и 'heading_only' (только курс)

const UITopo = (() => {
    let topoPanel = null;
    let isVisible = false;
    let isGnssConnected = false;
    let onApplyCallback = null;
    let onClearCallback = null;
	let onHeadingAppliedCallback = null;
    let setStatusCallback = null;
    
    // Функции для работы с AZMManager
    let getGnssConnected = null;
    let getAntennaMode = null;
    let setAntennaPosition = null;
    let setAntennaHeading = null;
    let recalcAllBeacons = null;
    let updateAntennaInfoUI = null;
    let updateAllButtons = null;
    
    // Режим панели: 'full' | 'heading_only'
    let topoMode = 'full';
    
    // Состояние компаса
    let compassActive = false;
    let compassValues = [];
    let compassUpdateTimer = null;
    let compassStabilityTimer = null;
    
    function init(panelId, callbacks) {
        topoPanel = document.getElementById(panelId);
        if (!topoPanel) return;
        
        setStatusCallback = callbacks.setStatus;
        getGnssConnected = callbacks.getGnssConnected;
        getAntennaMode = callbacks.getAntennaMode;
        setAntennaPosition = callbacks.setAntennaPosition;
        setAntennaHeading = callbacks.setAntennaHeading;
        recalcAllBeacons = callbacks.recalcAllBeacons;
        updateAntennaInfoUI = callbacks.updateAntennaInfoUI;
        updateAllButtons = callbacks.updateAllButtons;
        onApplyCallback = callbacks.onApply;
        onClearCallback = callbacks.onClear;
		onHeadingAppliedCallback = callbacks.onHeadingApplied || null;
        
        // Навешиваем обработчик на селектор режима
        const modeSelect = document.getElementById('topo-mode');
        if (modeSelect) {
            modeSelect.addEventListener('change', () => {
                setTopoMode(modeSelect.value);
            });
        }
        
        // Автовыбор режима по текущему antennaMode
        autoSelectMode();
        
        loadTopoBinding();
    }
    
    // ========== РЕЖИМ ПАНЕЛИ ==========
    
    function autoSelectMode() {
        const antennaMode = getAntennaMode ? getAntennaMode() : 'geographic';
        if (antennaMode === 'beacon_referenced') {
            setTopoMode('heading_only');
        } else {
            setTopoMode('full');
        }
    }
    
    function setTopoMode(mode) {
        if (mode !== 'full' && mode !== 'heading_only') mode = 'full';
        topoMode = mode;
        
        const select = document.getElementById('topo-mode');
        if (select && select.value !== mode) select.value = mode;
        
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const hintEl = document.getElementById('topo-hint');
        
        if (mode === 'heading_only') {
            if (latEl) {
                latEl.value = '';
                latEl.disabled = true;
                latEl.placeholder = '(по опорным)';
            }
            if (lonEl) {
                lonEl.value = '';
                lonEl.disabled = true;
                lonEl.placeholder = '(по опорным)';
            }
            if (hintEl) {
                hintEl.style.display = 'block';
                hintEl.innerHTML = '⚓ Координаты будут вычислены по опорным маякам. Задайте только курс антенны.';
            }
        } else {
            if (latEl) { latEl.disabled = false; latEl.placeholder = '55.123456'; }
            if (lonEl) { lonEl.disabled = false; lonEl.placeholder = '37.654321'; }
            if (hintEl) {
                // Показываем подсказку, если текущий режим — beacon_referenced
                const antennaMode = getAntennaMode ? getAntennaMode() : 'geographic';
                if (antennaMode === 'beacon_referenced') {
                    hintEl.style.display = 'block';
                    hintEl.innerHTML = '⚠ Режим антенны — ⚓ по опорным. Координаты будут перезаписаны.';
                } else {
                    hintEl.style.display = 'none';
                }
            }
        }
    }
    
    function getTopoMode() {
        return topoMode;
    }
    
    // ========== ПОКАЗ / СКРЫТИЕ ПАНЕЛИ ==========
    
    function toggle() {
        isVisible = !isVisible;
        if (isVisible) {
            autoSelectMode();
            topoPanel.classList.add('visible');
            updateGNSSStatus();
        } else {
            topoPanel.classList.remove('visible');
            stopCompassUpdates();
        }
    }
    
    function isOpen() {
        return isVisible;
    }
    
    function updateGNSSStatus() {
        const statusEl = document.getElementById('topo-gnss-status');
        if (!statusEl) return;
        
        const gnssConnected = getGnssConnected ? getGnssConnected() : false;
        if (gnssConnected) {
            statusEl.textContent = '✓ Внешний GNSS подключен';
            statusEl.className = 'locked';
        } else {
            statusEl.textContent = 'Внешний GNSS не подключен';
            statusEl.className = '';
        }
    }
    
    // ========== GPS + КОМПАС ==========
    
    function getPhoneGPS() {
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const statusEl = document.getElementById('topo-gnss-status');

        if (!navigator.geolocation) {
            statusEl.textContent = 'GPS недоступен';
            statusEl.className = '';
            return;
        }

        statusEl.textContent = 'Поиск GPS...';
        statusEl.className = '';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                // Заполняем только если поля не disabled
                if (latEl && !latEl.disabled) latEl.value = pos.coords.latitude.toFixed(6);
                if (lonEl && !lonEl.disabled) lonEl.value = pos.coords.longitude.toFixed(6);
                
                startCompassUpdates();
                
                statusEl.innerHTML = `✓ Координаты получены (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})<br>Запуск компаса...`;
                statusEl.className = 'locked';
            },
            (err) => {
                statusEl.textContent = 'Ошибка: ' + err.message;
                statusEl.className = '';
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }
    
    function startCompassUpdates() {
        if (compassActive) return;
        
        compassActive = true;
        compassValues = [];
        
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'app://start_compass';
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 100);
        
        window.addEventListener('native-compass-update', handleCompassUpdate);
        
        compassUpdateTimer = setInterval(updateCompassUI, 500);
        compassStabilityTimer = setInterval(checkCompassStability, 2000);
    }
    
    function handleCompassUpdate() {
        if (!compassActive) return;
        
        const heading = window._nativeCompass?.heading;
        if (heading !== undefined && !isNaN(heading)) {
            compassValues.push({ heading: heading, timestamp: Date.now() });
            if (compassValues.length > 20) compassValues.shift();
        }
    }
    
    function updateCompassUI() {
        if (!compassActive || !isVisible) return;
        
        const heading = window._nativeCompass?.heading;
        const hdgEl = document.getElementById('topo-hdg');
        const statusEl = document.getElementById('topo-gnss-status');
        
        if (heading !== undefined && !isNaN(heading) && hdgEl) {
            hdgEl.value = heading.toFixed(1);
            
            if (statusEl) {
                const stability = getCompassStability();
                const stabilityIcon = stability === 'stable' ? '✅' : stability === 'medium' ? '⚠️' : '🔄';
                const stabilityText = stability === 'stable' ? 'Стабильно' : stability === 'medium' ? 'Нестабильно' : 'Измерение...';
                
                statusEl.innerHTML = `
                    🧭 Азимут: ${heading.toFixed(1)}° ${stabilityIcon} ${stabilityText}<br>
                    <small style="font-size:10px;">
                        📱 Держите устройство горизонтально<br>
                        ➡️ Сориентируйте его по нулевому направлению антенны
                    </small>
                `;
                statusEl.className = 'locked';
            }
        }
    }
    
    function getCompassStability() {
        if (compassValues.length < 5) return 'measuring';
        
        const recent = compassValues.slice(-5);
        const headings = recent.map(v => v.heading);
        
        let maxDiff = 0;
        for (let i = 0; i < headings.length; i++) {
            for (let j = i + 1; j < headings.length; j++) {
                let diff = Math.abs(headings[i] - headings[j]);
                if (diff > 180) diff = 360 - diff;
                maxDiff = Math.max(maxDiff, diff);
            }
        }
        
        if (maxDiff < 2) return 'stable';
        if (maxDiff < 5) return 'medium';
        return 'unstable';
    }
    
    function checkCompassStability() {
        if (!compassActive || !isVisible) return;
        
        const stability = getCompassStability();
        const statusEl = document.getElementById('topo-gnss-status');
        
        if (statusEl && stability === 'stable') {
            const heading = window._nativeCompass?.heading;
            if (heading !== undefined && !isNaN(heading)) {
                statusEl.innerHTML = `
                    ✅ Азимут стабилен: ${heading.toFixed(1)}°<br>
                    <small style="font-size:10px;">
                        Можно применять топопривязку
                    </small>
                `;
                statusEl.className = 'locked';
            }
        }
    }
    
    function stopCompassUpdates() {
        if (!compassActive) return;
        
        compassActive = false;
        window.removeEventListener('native-compass-update', handleCompassUpdate);
        
        if (compassUpdateTimer) { clearInterval(compassUpdateTimer); compassUpdateTimer = null; }
        if (compassStabilityTimer) { clearInterval(compassStabilityTimer); compassStabilityTimer = null; }
        
        stopCompass();
    }
    
    function stopCompass() {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'app://stop_compass';
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 100);
    }
    
    // ========== ПРИМЕНЕНИЕ ==========
    
    function applyBinding() {
        const hdgRaw = parseFloat(document.getElementById('topo-hdg').value);
        
        const savedBinding = loadTopoBindingFromStorage();
        const finalHdg = !isNaN(hdgRaw) ? hdgRaw : (savedBinding?.hdg ?? NaN);
        
        if (isNaN(finalHdg)) {
            alert('Введите курс (направление антенны, 0-360°)');
            return;
        }
        if (finalHdg < 0 || finalHdg > 360) { alert('Курс: 0…360°'); return; }
        
        // === РЕЖИМ "ТОЛЬКО КУРС" ===
        if (topoMode === 'heading_only') {
            if (setAntennaPosition) {
                setAntennaPosition(NaN, NaN, finalHdg);
            }
            if (recalcAllBeacons) recalcAllBeacons();
            if (updateAntennaInfoUI) updateAntennaInfoUI();
            saveTopoBinding(NaN, NaN, finalHdg);
            
            stopCompassUpdates();
            if (isVisible) toggle();
            if (updateAllButtons) updateAllButtons();
            
            if (setStatusCallback) {
                setStatusCallback(`Курс антенны: ${finalHdg.toFixed(1)}° (координаты — по опорным)`);
            }
            if (onApplyCallback) onApplyCallback(NaN, NaN, finalHdg);
			if (onHeadingAppliedCallback) onHeadingAppliedCallback(); 
            return;
        }
        
        // === РЕЖИМ "ПОЛНАЯ ПРИВЯЗКА" ===
        const latRaw = parseFloat(document.getElementById('topo-lat').value);
        const lonRaw = parseFloat(document.getElementById('topo-lon').value);
        
        const finalLat = !isNaN(latRaw) ? latRaw : (savedBinding?.lat ?? NaN);
        const finalLon = !isNaN(lonRaw) ? lonRaw : (savedBinding?.lon ?? NaN);
        
        if (isNaN(finalLat) || isNaN(finalLon)) {
            alert('Введите координаты (или переключитесь в режим «Только курс»)');
            return;
        }
        if (finalLat < -90 || finalLat > 90) { alert('Широта: -90…90'); return; }
        if (finalLon < -180 || finalLon > 180) { alert('Долгота: -180…180'); return; }
        
        if (setAntennaPosition) {
            setAntennaPosition(finalLat, finalLon, finalHdg);
        }
        if (recalcAllBeacons) recalcAllBeacons();
        if (updateAntennaInfoUI) updateAntennaInfoUI();
        saveTopoBinding(finalLat, finalLon, finalHdg);
        
        stopCompassUpdates();
        if (isVisible) toggle();
        if (updateAllButtons) updateAllButtons();
        
        if (setStatusCallback) {
            setStatusCallback(`Топопривязка: ${finalLat.toFixed(5)}, ${finalLon.toFixed(5)}, ${finalHdg.toFixed(1)}°`);
        }
        if (onApplyCallback) onApplyCallback(finalLat, finalLon, finalHdg);
    }
    
    /**
     * Быстрое применение только курса (для вызова из reference-панели).
     */
    function applyHeadingOnly(hdg) {
        if (isNaN(hdg)) return false;
        if (hdg < 0 || hdg > 360) return false;
        
        if (setAntennaPosition) {
            setAntennaPosition(NaN, NaN, hdg);
        }
        if (recalcAllBeacons) recalcAllBeacons();
        if (updateAntennaInfoUI) updateAntennaInfoUI();
        saveTopoBinding(NaN, NaN, hdg);
        
        if (setStatusCallback) {
            setStatusCallback(`Курс антенны: ${hdg.toFixed(1)}° (координаты — по опорным)`);
        }
        return true;
    }
    
    function clearBinding() {
        if (setAntennaPosition) {
            setAntennaPosition(NaN, NaN, NaN);
        }
        if (updateAntennaInfoUI) updateAntennaInfoUI();
        try { localStorage.removeItem('topo_binding'); } catch (e) {}
        if (setStatusCallback) setStatusCallback('Топопривязка сброшена');
        
        stopCompassUpdates();
        if (isVisible) toggle();
        if (updateAllButtons) updateAllButtons();
        if (onClearCallback) onClearCallback();
    }
    
    // ========== СОХРАНЕНИЕ ==========
    
    function saveTopoBinding(lat, lon, hdg) {
        try {
            const latVal = (lat === null || isNaN(lat)) ? null : lat;
            const lonVal = (lon === null || isNaN(lon)) ? null : lon;
            const hdgVal = (hdg === null || isNaN(hdg)) ? null : hdg;
            
            localStorage.setItem('topo_binding', JSON.stringify({
                lat: latVal,
                lon: lonVal,
                hdg: hdgVal,
                mode: (latVal === null && lonVal === null) ? 'heading_only' : 'full',
                time: Date.now()
            }));
        } catch (e) {}
    }
    
    function loadTopoBinding() {
        try {
            const saved = localStorage.getItem('topo_binding');
            if (!saved) return;
            
            const data = JSON.parse(saved);
            const hasLat = data.lat !== null && data.lat !== undefined;
            const hasLon = data.lon !== null && data.lon !== undefined;
            const hasHdg = data.hdg !== null && data.hdg !== undefined;
            
            if (!hasHdg) return;
            
            // Устанавливаем в state
            if (hasLat && hasLon) {
                if (setAntennaPosition) setAntennaPosition(data.lat, data.lon, data.hdg);
            } else {
                if (setAntennaPosition) setAntennaPosition(NaN, NaN, data.hdg);
            }
            if (updateAntennaInfoUI) updateAntennaInfoUI();
            
            if (setStatusCallback) {
                if (hasLat && hasLon) {
                    setStatusCallback(`Загружена привязка: ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}, ${data.hdg.toFixed(1)}°`);
                } else {
                    setStatusCallback(`Загружен курс: ${data.hdg.toFixed(1)}° (координаты — по опорным)`);
                }
            }
            
            // Заполняем поля
            const latEl = document.getElementById('topo-lat');
            const lonEl = document.getElementById('topo-lon');
            const hdgEl = document.getElementById('topo-hdg');
            
            if (hasLat && latEl) latEl.value = data.lat.toFixed(6);
            if (hasLon && lonEl) lonEl.value = data.lon.toFixed(6);
            if (hasHdg && hdgEl) hdgEl.value = data.hdg.toFixed(1);
        } catch (e) {}
    }
    
    function loadTopoBindingFromStorage() {
        try {
            const saved = localStorage.getItem('topo_binding');
            if (saved) {
                const data = JSON.parse(saved);
                return {
                    lat: (data.lat === null || data.lat === undefined) ? NaN : data.lat,
                    lon: (data.lon === null || data.lon === undefined) ? NaN : data.lon,
                    hdg: (data.hdg === null || data.hdg === undefined) ? NaN : data.hdg
                };
            }
        } catch (e) {}
        return null;
    }
    
    function setGnssConnected(connected) {
        isGnssConnected = connected;
        if (isVisible) updateGNSSStatus();
    }
    
    function updateFieldsFromGNSS(lat, lon, hdg) {
        if (!isVisible) return;
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const hdgEl = document.getElementById('topo-hdg');
        if (latEl && !latEl.disabled && latEl.value === '') latEl.value = lat.toFixed(6);
        if (lonEl && !lonEl.disabled && lonEl.value === '') lonEl.value = lon.toFixed(6);
        if (hdgEl && hdgEl.value === '') hdgEl.value = hdg.toFixed(1);
    }
    
    return {
        init,
        toggle,
        isOpen,
        applyBinding,
        applyHeadingOnly,
        clearBinding,
        getPhoneGPS,
        setGnssConnected,
        updateFieldsFromGNSS,
        loadTopoBinding,
        updateGNSSStatus,
        startCompassUpdates,
        stopCompassUpdates,
        setTopoMode,
        getTopoMode,
        autoSelectMode
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITopo;
}