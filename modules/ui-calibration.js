// modules/ui-calibration.js
// Управление калибровкой φ (угловая калибровка антенны)

const UICalibration = (() => {
    let calibrationPanel = null;
    let isCalibrating = false;
    
    // Колбэки для работы с внешними модулями
    let getState = null;
    let setAntennaOffsets = null;
    let saveSettingsCallback = null;
    let setStatusCallback = null;
    let isConnectedCallback = null;
    let getSerialBridge = null;
    let getStartCommand = null;
    let logOutgoingCallback = null;
    let recalcAllBeacons = null;
    
    function init(panelId, callbacks) {
        calibrationPanel = document.getElementById(panelId);
        if (!calibrationPanel) return;
        
        getState = callbacks.getState;
        setAntennaOffsets = callbacks.setAntennaOffsets;
        saveSettingsCallback = callbacks.saveSettings;
        setStatusCallback = callbacks.setStatus;
        isConnectedCallback = callbacks.isConnected;
        getSerialBridge = callbacks.getSerialBridge;
        getStartCommand = callbacks.getStartCommand;
        logOutgoingCallback = callbacks.logOutgoing;
        recalcAllBeacons = callbacks.recalcAllBeacons;
    }
    
    function toggle() {
        if (calibrationPanel.style.display === 'none' || !calibrationPanel.style.display) {
            calibrationPanel.style.display = 'block';
            const count = window.AngularCalibration ? AngularCalibration.getCount() : 0;
            const statusEl = document.getElementById('cal-status');
            if (statusEl) statusEl.textContent = 'Собрано: ' + count;
        } else {
            calibrationPanel.style.display = 'none';
            if (isCalibrating) stop();
        }
    }
    
    function start() {
        if (!window.AngularCalibration) return;
        
        const state = getState ? getState() : {};
        AngularCalibration.reset();
        AngularCalibration.setOffsets(state.offsetXM, state.offsetYM);
        isCalibrating = true;
        
        const statusEl = document.getElementById('cal-status');
        if (statusEl) statusEl.textContent = 'Собрано: 0';
        if (setStatusCallback) setStatusCallback('Калибровка начата');
        
        document.getElementById('btn-cal-start').disabled = true;
        document.getElementById('btn-cal-stop').disabled = false;
        document.getElementById('cfg-cal-from').disabled = true;
        document.getElementById('cfg-cal-to').disabled = true;
        document.getElementById('cfg-cal-step').disabled = true;
        document.getElementById('cfg-cal-points').disabled = true;
    }
    
    function stop() {
        if (!isCalibrating) return;
        if (!window.AngularCalibration) return;
        
        isCalibrating = false;
        
        document.getElementById('btn-cal-start').disabled = false;
        document.getElementById('btn-cal-stop').disabled = true;
        document.getElementById('cfg-cal-from').disabled = false;
        document.getElementById('cfg-cal-to').disabled = false;
        document.getElementById('cfg-cal-step').disabled = false;
        document.getElementById('cfg-cal-points').disabled = false;
        
        const fromAngle = parseFloat(document.getElementById('cfg-cal-from').value) || 0;
        const toAngle = parseFloat(document.getElementById('cfg-cal-to').value) || 360;
        const step = parseFloat(document.getElementById('cfg-cal-step').value) || 1;
        
        const phi = AngularCalibration.calibratePhi(fromAngle, toAngle, step);
        
        if (!isNaN(phi)) {
            const choice = confirm(
                `Калибровка завершена.\n\n` +
                `φ = ${phi.toFixed(1)}°\n` +
                `Собрано точек: ${AngularCalibration.getCount()}\n\n` +
                `Применить это значение?`
            );
            
            if (choice) {
                const phiEl = document.getElementById('cfg-phi');
                if (phiEl) phiEl.value = phi.toFixed(1);
                
                if (setAntennaOffsets) {
                    const state = getState ? getState() : {};
                    setAntennaOffsets(state.offsetXM, state.offsetYM, phi);
                }
                if (saveSettingsCallback) saveSettingsCallback();
                if (setStatusCallback) setStatusCallback(`Калибровка завершена. φ = ${phi.toFixed(1)}°`);
                
                const statusEl = document.getElementById('cal-status');
                if (statusEl) statusEl.textContent = `✓ φ = ${phi.toFixed(1)}°`;
                
                const isConnected = isConnectedCallback ? isConnectedCallback() : false;
                const state = getState ? getState() : {};
                if (isConnected && state.isInterrogationActive) {
                    const serialBridge = getSerialBridge ? getSerialBridge() : null;
                    const cmd = getStartCommand ? getStartCommand() : null;
                    if (serialBridge && cmd) {
                        if (logOutgoingCallback) logOutgoingCallback('AZM', cmd.trim());
                        serialBridge.send(cmd);
                    }
                }
            } else {
                const statusEl = document.getElementById('cal-status');
                if (statusEl) statusEl.textContent = 'Отклонено';
                if (setStatusCallback) setStatusCallback('Калибровка отклонена');
            }
        } else {
            if (setStatusCallback) setStatusCallback('Недостаточно точек для калибровки');
            const statusEl = document.getElementById('cal-status');
            if (statusEl) statusEl.textContent = 'Недостаточно точек';
        }
    }
    
    function isActive() {
        return isCalibrating;
    }
    
    function addPoint(data) {
        if (!isCalibrating) return;
        if (!window.AngularCalibration) return;
        
        // Эта функция вызывается из handleBeaconUpdate
        // Данные уже добавляются в AngularCalibration там
        const count = AngularCalibration.getCount();
        const maxPoints = parseInt(document.getElementById('cfg-cal-points')?.value) || 100;
        const statusEl = document.getElementById('cal-status');
        if (statusEl) statusEl.textContent = 'Собрано: ' + count;
        if (count >= maxPoints) stop();
    }
    
    // ========== КАЛИБРОВОЧНАЯ ТАБЛИЦА ==========
    
    async function loadCalibrationFile() {
        try {
            if (window.showOpenFilePicker) {
                const [fileHandle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'CSV Files',
                        accept: { 'text/csv': ['.csv', '.txt'] }
                    }]
                });
                const file = await fileHandle.getFile();
                const text = await file.text();
                applyCalibrationData(text, file.name);
            } else {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.csv,.txt';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        applyCalibrationData(ev.target.result, file.name);
                    };
                    reader.readAsText(file);
                };
                input.click();
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('[UICalibration] Ошибка загрузки:', e);
                alert('Ошибка загрузки: ' + e.message);
            }
        }
    }
    
    function applyCalibrationData(text, filename) {
        try {
            const { angles, errors } = window.AntennaCorrector.parseFromText(text);
            if (window.AZMManager) {
                AZMManager.loadAntennaCalibration(angles, errors);
            }
            saveCalibrationToStorage(angles, errors);
            updateCalibrationUI(angles.length);
            if (recalcAllBeacons) recalcAllBeacons();
            if (setStatusCallback) setStatusCallback(`Калибровка загружена: ${angles.length} точек`);
        } catch (e) {
            alert('Ошибка формата файла: ' + e.message);
        }
    }
    
    function resetCalibration() {
        if (confirm('Сбросить калибровочную таблицу антенны?')) {
            if (window.AZMManager) {
                AZMManager.resetAntennaCalibration();
            }
            localStorage.removeItem('antenna_calibration');
            updateCalibrationUI(0);
            if (recalcAllBeacons) recalcAllBeacons();
            if (setStatusCallback) setStatusCallback('Калибровка сброшена');
        }
    }
    
    function updateCalibrationUI(pointCount) {
        const infoRow = document.getElementById('calibration-info');
        const statusEl = document.getElementById('calibration-status');
        const resetBtn = document.getElementById('btn-reset-calibration');
        
        if (pointCount > 0) {
            if (infoRow) infoRow.style.display = 'flex';
            if (statusEl) statusEl.textContent = `✓ Загружено ${pointCount} точек`;
            if (resetBtn) resetBtn.style.display = 'inline-block';
        } else {
            if (infoRow) infoRow.style.display = 'none';
            if (statusEl) statusEl.textContent = '';
            if (resetBtn) resetBtn.style.display = 'none';
        }
    }
    
    function saveCalibrationToStorage(angles, errors) {
        try {
            localStorage.setItem('antenna_calibration', JSON.stringify({ angles, errors }));
        } catch (e) {
            console.warn('Не удалось сохранить калибровку:', e);
        }
    }
    
    function loadCalibrationFromStorage() {
        try {
            const saved = localStorage.getItem('antenna_calibration');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.angles && data.errors && data.angles.length >= 2) {
                    if (window.AZMManager) {
                        AZMManager.loadAntennaCalibration(data.angles, data.errors);
                    }
                    updateCalibrationUI(data.angles.length);
                    return true;
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки калибровки из storage:', e);
        }
        updateCalibrationUI(0);
        return false;
    }
    
    return {
        init,
        toggle,
        start,
        stop,
        isActive,
        addPoint,
        loadCalibrationFile,
        resetCalibration,
        loadCalibrationFromStorage
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UICalibration;
}