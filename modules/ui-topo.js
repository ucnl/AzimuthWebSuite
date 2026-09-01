// modules/ui-topo.js
// Управление ручной топопривязкой (координаты антенны)

const UITopo = (() => {
    let topoPanel = null;
    let isVisible = false;
    let isGnssConnected = false;
    let onApplyCallback = null;
    let onClearCallback = null;
    let setStatusCallback = null;
    
    // Функции для работы с AZMManager
    let getGnssConnected = null;
    let setAntennaPosition = null;
    let recalcAllBeacons = null;
    let updateAntennaInfoUI = null;
    let updateAllButtons = null;
    
    // Состояние компаса
    let compassActive = false;
    let compassValues = [];
    let compassUpdateTimer = null;
    let compassStabilityTimer = null;
    
    function init(panelId, callbacks) {
        topoPanel = document.getElementById(panelId);
        if (!topoPanel) return;
        
        // Сохраняем колбэки
        setStatusCallback = callbacks.setStatus;
        getGnssConnected = callbacks.getGnssConnected;
        setAntennaPosition = callbacks.setAntennaPosition;
        recalcAllBeacons = callbacks.recalcAllBeacons;
        updateAntennaInfoUI = callbacks.updateAntennaInfoUI;
        updateAllButtons = callbacks.updateAllButtons;
        onApplyCallback = callbacks.onApply;
        onClearCallback = callbacks.onClear;
        
        // Инициализируем поля
        loadTopoBinding();
    }
    
    function toggle() {
        isVisible = !isVisible;
        if (isVisible) {
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

        // Получаем координаты через нативный GPS
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                latEl.value = pos.coords.latitude.toFixed(6);
                lonEl.value = pos.coords.longitude.toFixed(6);
                
                // Запускаем компас для получения азимута
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
        
        // Запускаем нативный компас
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'app://start_compass';
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 100);
        
        // Слушаем обновления компаса
        window.addEventListener('native-compass-update', handleCompassUpdate);
        
        // Обновляем UI каждые 500мс
        compassUpdateTimer = setInterval(updateCompassUI, 500);
        
        // Проверяем стабильность каждые 2 секунды
        compassStabilityTimer = setInterval(checkCompassStability, 2000);
    }
    
    function handleCompassUpdate() {
        if (!compassActive) return;
        
        const heading = window._nativeCompass?.heading;
        if (heading !== undefined && !isNaN(heading)) {
            // Добавляем значение в массив для анализа стабильности
            compassValues.push({
                heading: heading,
                timestamp: Date.now()
            });
            
            // Ограничиваем массив последними 20 значениями
            if (compassValues.length > 20) {
                compassValues.shift();
            }
        }
    }
    
    function updateCompassUI() {
        if (!compassActive || !isVisible) return;
        
        const heading = window._nativeCompass?.heading;
        const hdgEl = document.getElementById('topo-hdg');
        const statusEl = document.getElementById('topo-gnss-status');
        
        if (heading !== undefined && !isNaN(heading) && hdgEl) {
            // Обновляем поле курса в реальном времени
            hdgEl.value = heading.toFixed(1);
            
            // Обновляем статус
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
        
        // Берем последние 5 значений
        const recent = compassValues.slice(-5);
        const headings = recent.map(v => v.heading);
        
        // Вычисляем разброс (учитывая циклическую природу углов)
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
            // Если стабильно - можно останавливать компас
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
        
        // Удаляем слушатель
        window.removeEventListener('native-compass-update', handleCompassUpdate);
        
        // Очищаем таймеры
        if (compassUpdateTimer) {
            clearInterval(compassUpdateTimer);
            compassUpdateTimer = null;
        }
        if (compassStabilityTimer) {
            clearInterval(compassStabilityTimer);
            compassStabilityTimer = null;
        }
        
        // Останавливаем нативный компас
        stopCompass();
    }
    
    function stopCompass() {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'app://stop_compass';
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 100);
    }
    
    function applyBinding() {
        const lat = parseFloat(document.getElementById('topo-lat').value);
        const lon = parseFloat(document.getElementById('topo-lon').value);
        const hdg = parseFloat(document.getElementById('topo-hdg').value);

        const savedBinding = loadTopoBindingFromStorage();
        
        const finalLat = !isNaN(lat) ? lat : (savedBinding?.lat ?? NaN);
        const finalLon = !isNaN(lon) ? lon : (savedBinding?.lon ?? NaN);
        const finalHdg = !isNaN(hdg) ? hdg : (savedBinding?.hdg ?? NaN);

        if (isNaN(finalLat) || isNaN(finalLon)) {
            alert('Введите координаты (или подключите внешний GNSS)');
            return;
        }
        if (isNaN(finalHdg)) {
            alert('Введите курс (направление антенны, 0-360°)');
            return;
        }
        if (finalLat < -90 || finalLat > 90) { alert('Широта: -90…90'); return; }
        if (finalLon < -180 || finalLon > 180) { alert('Долгота: -180…180'); return; }
        if (finalHdg < 0 || finalHdg > 360) { alert('Курс: 0…360°'); return; }

        if (setAntennaPosition) {
            setAntennaPosition(finalLat, finalLon, finalHdg);
        }
        if (recalcAllBeacons) recalcAllBeacons();
        if (updateAntennaInfoUI) updateAntennaInfoUI();
        saveTopoBinding(finalLat, finalLon, finalHdg);

        // Останавливаем компас
        stopCompassUpdates();
        
        if (isVisible) toggle();
        if (updateAllButtons) updateAllButtons();

        if (setStatusCallback) {
            setStatusCallback(`Топопривязка: ${finalLat.toFixed(5)}, ${finalLon.toFixed(5)}, ${finalHdg.toFixed(1)}°`);
        }
        if (onApplyCallback) onApplyCallback(finalLat, finalLon, finalHdg);
    }
    
    function clearBinding() {
        if (setAntennaPosition) {
            setAntennaPosition(NaN, NaN, NaN);
        }
        if (updateAntennaInfoUI) updateAntennaInfoUI();
        try { localStorage.removeItem('topo_binding'); } catch (e) {}
        if (setStatusCallback) setStatusCallback('Топопривязка сброшена');

        // Останавливаем компас
        stopCompassUpdates();
        
        if (isVisible) toggle();
        if (updateAllButtons) updateAllButtons();
        if (onClearCallback) onClearCallback();
    }
    
    function saveTopoBinding(lat, lon, hdg) {
        try {
            localStorage.setItem('topo_binding', JSON.stringify({ lat, lon, hdg, time: Date.now() }));
        } catch (e) {}
    }
    
	function loadTopoBinding() {
		try {
			const saved = localStorage.getItem('topo_binding');
			if (saved) {
				const data = JSON.parse(saved);
				if (data.lat !== undefined && data.lon !== undefined && data.hdg !== undefined) {
					if (setAntennaPosition) {
						setAntennaPosition(data.lat, data.lon, data.hdg);
					}
					if (updateAntennaInfoUI) updateAntennaInfoUI();
					if (setStatusCallback) {
						setStatusCallback(`Загружена привязка: ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}, ${data.hdg.toFixed(1)}°`);
					}
					
					// ВСЕГДА заполняем поля, не проверяя на пустоту
					const latEl = document.getElementById('topo-lat');
					const lonEl = document.getElementById('topo-lon');
					const hdgEl = document.getElementById('topo-hdg');
					if (latEl) latEl.value = data.lat.toFixed(6);
					if (lonEl) lonEl.value = data.lon.toFixed(6);
					if (hdgEl) hdgEl.value = data.hdg.toFixed(1);
				}
			}
		} catch (e) {}
	}
    
    function loadTopoBindingFromStorage() {
        try {
            const saved = localStorage.getItem('topo_binding');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.lat !== undefined && data.lon !== undefined && data.hdg !== undefined) {
                    return { lat: data.lat, lon: data.lon, hdg: data.hdg };
                }
            }
        } catch (e) {}
        return null;
    }
    
    function setGnssConnected(connected) {
        isGnssConnected = connected;
        if (isVisible) updateGNSSStatus();
    }
    
    // Для обновления полей из внешнего GNSS
    function updateFieldsFromGNSS(lat, lon, hdg) {
        if (!isVisible) return;
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const hdgEl = document.getElementById('topo-hdg');
        if (latEl && latEl.value === '') latEl.value = lat.toFixed(6);
        if (lonEl && lonEl.value === '') lonEl.value = lon.toFixed(6);
        if (hdgEl && hdgEl.value === '') hdgEl.value = hdg.toFixed(1);
    }
    
    return {
        init,
        toggle,
        isOpen,
        applyBinding,
        clearBinding,
        getPhoneGPS,
        setGnssConnected,
        updateFieldsFromGNSS,
        loadTopoBinding,
        updateGNSSStatus,
        startCompassUpdates,
        stopCompassUpdates
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITopo;
}