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
				I18n.bindText(elStatus, 'module.antennaCalibration.collecting', { count: state.pointCount });
				elStatus.style.color = statusSuccess;
			} else {
				I18n.bindText(elStatus, 'module.antennaCalibration.count', { count: state.pointCount });
				elStatus.style.color = textPrimary;
			}
		}
		
		if (elProgress) {
			if (state.hasTable) {
				I18n.bindText(elProgress, 'module.antennaCalibration.sectors', { used: state.usedSectors, total: state.totalSectors, coverage: (state.coverage * 100).toFixed(1) });
				elProgress.style.color = state.coverage > 0.8 ? statusSuccess : statusWarning;
			} else {
				I18n.bindText(elProgress, 'module.antennaCalibration.noTable');
				elProgress.style.color = textSecondary;
			}
		}
		
		if (elCentroid) {
			if (state.hasCentroid) {
				I18n.bindText(elCentroid, 'module.antennaCalibration.centroid', { lat: state.centroidLat.toFixed(6), lon: state.centroidLon.toFixed(6) });
				elCentroid.style.color = statusSuccess;
			} else {
				I18n.bindText(elCentroid, 'module.antennaCalibration.noCentroid');
				elCentroid.style.color = statusWarning;
			}
		}
		
		if (elCoverage) {
			if (state.hasTable) {
				I18n.bindText(elCoverage, 'module.antennaCalibration.coverage', { coverage: (state.coverage * 100).toFixed(1) });
			} else {
				I18n.bindText(elCoverage, 'module.antennaCalibration.noCoverage');
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
        deps.setStatus?.(I18n.message('module.antennaCalibration.started'));
    }

    function stopCalibration() {
        isCollecting = false;
        updateUI();
        deps.setStatus?.(I18n.message('module.antennaCalibration.stopped', { count: AntennaTableCalibration.getCount() }));
    }

	function buildTable() {
		const stepDeg = parseFloat(document.getElementById('ac-angle-step')?.value) || 1.0;
		AntennaTableCalibration.setAngleStep(stepDeg);
		const result = AntennaTableCalibration.buildTable(stepDeg);  // ← убрать smoothWin
		
		if (result.encoderAngles.length === 0) {
			alert(I18n.t('module.antennaCalibration.buildFailed'));
			return;
		}
		
		updateUI();
		deps.setStatus?.(I18n.message('module.antennaCalibration.built', { used: result.usedSectors, coverage: (result.coverage * 100).toFixed(1) }));
	}

	function applyTable() {
        const success = AntennaTableCalibration.applyToManager();
        if (success) {
            deps.setStatus?.(I18n.message('module.antennaCalibration.applied'));
            alert(I18n.t('module.antennaCalibration.loaded'));
        } else {
            alert(I18n.t('module.antennaCalibration.noApply'));
        }
    }

    function downloadTable() {
        AntennaTableCalibration.downloadCSV();
        deps.setStatus?.(I18n.message('module.antennaCalibration.downloaded'));
    }

	function downloadFullData() {
		AntennaTableCalibration.downloadFullData();
		deps.setStatus?.(I18n.message('module.antennaCalibration.fullDownloaded'));
	}

    function toggleAntennaCalibration() {
        // Просто открываем панель — пользователь сам запустит накопление и воспроизведение
        if (!isOpen) open();
        deps.setStatus?.(I18n.message('module.antennaCalibration.instructions'));
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