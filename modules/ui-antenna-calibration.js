// modules/ui-antenna-calibration.js — UI для калибровки таблицы антенны

const UIAntennaCalibration = (() => {

    let panel = null;
    let isOpen = false;
    let deps = {};
    let isCollecting = false;  // идёт ли накопление (было isActive)

    // DOM-элементы
    let elStatus, elProgress, elCentroid, elCoverage;
    let elBtnStart, elBtnStop, elBtnBuild, elBtnApply, elBtnDownload;

    function init(dependencies) {
        deps = dependencies;
        panel = document.getElementById('antenna-calibration-panel');
        
        elStatus = document.getElementById('ac-status');
        elProgress = document.getElementById('ac-progress');
        elCentroid = document.getElementById('ac-centroid');
        elCoverage = document.getElementById('ac-coverage');
        
        elBtnStart = document.getElementById('ac-btn-start');
        elBtnStop = document.getElementById('ac-btn-stop');
        elBtnBuild = document.getElementById('ac-btn-build');
        elBtnApply = document.getElementById('ac-btn-apply');
        elBtnDownload = document.getElementById('ac-btn-download');
        
        updateUI();
    }

    function toggle() {
        if (isOpen) {
            close();
        } else {
            open();
        }
    }

    function open() {
        if (!panel) return;
        panel.style.display = 'block';
        isOpen = true;
        updateUI();
    }

    function close() {
        if (!panel) return;
        if (isCollecting) {
            // Не даём закрыть во время накопления
            return;
        }
        panel.style.display = 'none';
        isOpen = false;
    }

    // Геттер для app.js — проверка, идёт ли накопление
    function isActive() {
        return isCollecting;
    }

    // Вызывается из app.js при каждом принятом пакете маяка
    function addPoint() {
        if (!isCollecting) return;
        updateUI();
    }

	function updateUI() {
		const state = AntennaTableCalibration.getState();
		const rootStyles = getComputedStyle(document.documentElement);
		const statusSuccess = rootStyles.getPropertyValue('--status-success').trim() || '#4caf50';
		const statusWarning = rootStyles.getPropertyValue('--status-warning').trim() || '#ff9800';
		const textPrimary = rootStyles.getPropertyValue('--text-primary').trim() || '#fff';
		const textSecondary = rootStyles.getPropertyValue('--text-secondary').trim() || '#aaa';
		
		if (elStatus) {
			if (isCollecting) {
				elStatus.textContent = `⚡ Накопление... Собрано точек: ${state.pointCount}`;
				elStatus.style.color = statusSuccess;
			} else {
				elStatus.textContent = `Собрано точек: ${state.pointCount}`;
				elStatus.style.color = textPrimary;
			}
		}
		
		if (elProgress) {
			if (state.hasTable) {
				elProgress.textContent = `Секторов: ${state.usedSectors}/${state.totalSectors} (${(state.coverage * 100).toFixed(1)}%)`;
				elProgress.style.color = state.coverage > 0.8 ? statusSuccess : statusWarning;
			} else {
				elProgress.textContent = 'Таблица не построена';
				elProgress.style.color = textSecondary;
			}
		}
		
		if (elCentroid) {
			if (state.hasCentroid) {
				elCentroid.textContent = `Центроида: ${state.centroidLat.toFixed(6)}°, ${state.centroidLon.toFixed(6)}°`;
				elCentroid.style.color = statusSuccess;
			} else {
				elCentroid.textContent = 'Центроида: недостаточно данных';
				elCentroid.style.color = statusWarning;
			}
		}
		
		if (elCoverage) {
			if (state.hasTable) {
				elCoverage.textContent = `Покрытие: ${(state.coverage * 100).toFixed(1)}%`;
			} else {
				elCoverage.textContent = 'Покрытие: --';
			}
		}
		
		// Кнопки без изменений
		if (elBtnStart) elBtnStart.disabled = isCollecting;
		if (elBtnStop) elBtnStop.disabled = !isCollecting;
		if (elBtnBuild) elBtnBuild.disabled = state.pointCount < 10;
		if (elBtnApply) elBtnApply.disabled = !state.hasTable;
		if (elBtnDownload) elBtnDownload.disabled = !state.hasTable;
	}

    function startCalibration() {
        AntennaTableCalibration.reset();
        isCollecting = true;
        updateUI();
        deps.setStatus?.('📡 Калибровка антенны: накопление точек...');
    }

    function stopCalibration() {
        isCollecting = false;
        updateUI();
        deps.setStatus?.('Накопление остановлено. ' + AntennaTableCalibration.getCount() + ' точек собрано');
    }

	function buildTable() {
		const stepDeg = parseFloat(document.getElementById('ac-angle-step')?.value) || 1.0;
		AntennaTableCalibration.setAngleStep(stepDeg);
		const result = AntennaTableCalibration.buildTable(stepDeg);  // ← убрать smoothWin
		
		if (result.encoderAngles.length === 0) {
			alert('Не удалось построить таблицу. Недостаточно данных.');
			return;
		}
		
		updateUI();
		deps.setStatus?.(`✅ Таблица построена: ${result.usedSectors} секторов, покрытие ${(result.coverage * 100).toFixed(1)}%`);
	}

    function applyTable() {
        const success = AntennaTableCalibration.applyToManager();
        if (success) {
            deps.setStatus?.('✅ Калибровочная таблица применена');
            alert('Таблица загружена в AntennaCorrector');
        } else {
            alert('Нет таблицы для применения');
        }
    }

    function downloadTable() {
        AntennaTableCalibration.downloadCSV();
        deps.setStatus?.('💾 Таблица скачана');
    }

	function downloadFullData() {
		AntennaTableCalibration.downloadFullData();
		deps.setStatus?.('💾 Полные данные скачаны');
	}

    function toggleAntennaCalibration() {
        // Просто открываем панель — пользователь сам запустит накопление и воспроизведение
        if (!isOpen) open();
        deps.setStatus?.('Нажмите ▶ Старт, затем ▶ Воспроизвести лог');
    }

    return {
        init,
        toggle,
        open,
        close,
        isActive,
        addPoint,
        updateUI,
        startCalibration,
        stopCalibration,
        buildTable,
        applyTable,
        downloadTable,
		downloadFullData,
        toggleAntennaCalibration,
        get isOpen() { return isOpen; }
    };

})();