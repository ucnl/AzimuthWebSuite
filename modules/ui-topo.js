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

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                latEl.value = pos.coords.latitude.toFixed(6);
                lonEl.value = pos.coords.longitude.toFixed(6);
                statusEl.textContent = `✓ ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${pos.coords.accuracy.toFixed(0)}м)`;
                statusEl.className = 'locked';
            },
            (err) => {
                statusEl.textContent = 'Ошибка: ' + err.message;
                statusEl.className = '';
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
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
        updateGNSSStatus
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITopo;
}