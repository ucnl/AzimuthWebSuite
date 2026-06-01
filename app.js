// app.js — Главный модуль приложения Zima2 USBL Web PWA
// Связывает SerialBridge, AZMParser, AZMManager, TrackManager, Logger, Canvas

const App = (() => {

    // ========== DOM-ЭЛЕМЕНТЫ ==========
    let canvas, ctx;
    let mapContainer, beaconsBar, scaleBarEl;
    let topoPanel, settingsOverlay;
    let connectionIndicator, statusText, deviceLabel;
	
    let btnTracksShow, btnTracksClear, btnTracksExport;
	
	let btnConnection, btnInterrogation, btnSettings;
	let btnGnss;
	
    let playbackProgress, playbackProgressFill;
	
	let calibrationPanel;
	
	let activeDropdown = null;
	let lastBeaconsHash = '';

    // ========== СОСТОЯНИЕ КАРТЫ ==========
    let scale = 100;
    let offsetX = 0, offsetY = 0;
    let isDragging = false;
    let lastMouseX = 0, lastMouseY = 0;
    let autoScaleEnabled = true;

    // ========== СОСТОЯНИЕ ПРИЛОЖЕНИЯ ==========
    let serialBridge = null;
    let isConnected = false;
    let ageTimer = null;
    let topoVisible = false;
    let settingsVisible = false;
	let isCalibrating = false;
	let compassMode = 'auto';
	let hasTrueHeading = false;
	
	const themes = ['theme-indoor', 'theme-light', 'theme-dark-contrast'];
	let currentTheme = 0;
	
	let analysisPanel, analysisContent;
	let lastAnalysisText = '';

    // ========== ТОПОПРИВЯЗКА ==========
	let gnssBridge = null;
	let isGnssConnected = false;

    // ========== ВСПОМОГАТЕЛЬНЫЕ ==========
	function toggleDropdown(id) {
		const menu = document.getElementById(id);
		if (activeDropdown && activeDropdown !== menu) {
			activeDropdown.style.display = 'none';
		}
		if (menu.style.display === 'block') {
			menu.style.display = 'none';
			activeDropdown = null;
		} else {
			menu.style.display = 'block';
			activeDropdown = menu;
		}
	}

	function closeAllDropdowns() {
		if (activeDropdown) {
			activeDropdown.style.display = 'none';
			activeDropdown = null;
		}
	}

	function showLogAnalysis() {
		const entries = Logger.getEntries();
		if (entries.length === 0) {
			alert('Нет данных для анализа. Загрузите лог.');
			return;
		}

		const report = LogAnalyzer.analyze(entries);
		lastAnalysisText = LogAnalyzer.formatReport(report);
		analysisContent.innerHTML = lastAnalysisText;
		analysisPanel.style.display = 'block';
	}

	function closeAnalysis() {
		analysisPanel.style.display = 'none';
	}

	function copyAnalysis() {
		const text = analysisContent.innerText;
		navigator.clipboard.writeText(text).then(() => {
			setStatus('Отчёт скопирован');
		}).catch(() => {
			alert('Не удалось скопировать');
		});
	}

	function cycleTheme() {
		// Убираем все темы
		document.documentElement.classList.remove(...themes);
		// Следующая тема
		currentTheme = (currentTheme + 1) % themes.length;
		// Применяем
		if (currentTheme > 0) {
			document.documentElement.classList.add(themes[currentTheme]);
		}
		// Сохраняем
		localStorage.setItem('theme', currentTheme);
		setStatus('Тема: ' + ['Indoor', 'Light', 'Dark'][currentTheme]);
    }
	
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function setStatus(msg) {
        if (statusText) statusText.textContent = msg;
        console.log('[App]', msg);
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
	
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
		
		LogStorage.open().catch(e => console.warn('IndexedDB недоступна:', e));
        console.log('[App] Инициализация...');

        canvas = document.getElementById('map-canvas');
        ctx = canvas.getContext('2d');
        mapContainer = document.getElementById('map-container');
        beaconsBar = document.getElementById('beacons-bar');
        scaleBarEl = document.getElementById('scale-bar');
        topoPanel = document.getElementById('topo-panel');
        settingsOverlay = document.getElementById('settings-overlay');

        connectionIndicator = document.getElementById('connection-indicator');
        statusText = document.getElementById('status-text');
        deviceLabel = document.getElementById('device-label');

		btnConnection = document.getElementById('btn-connection');
		btnInterrogation = document.getElementById('btn-interrogation');
		btnGnss = document.getElementById('btn-gnss');		
		
        btnSettings = document.getElementById('btn-settings');
        btnTracksShow = document.getElementById('btn-tracks-show');
        btnTracksClear = document.getElementById('btn-tracks-clear');
        btnTracksExport = document.getElementById('btn-tracks-export');

        playbackProgress = document.getElementById('playback-progress');
        playbackProgressFill = document.getElementById('playback-progress-fill');
		
		calibrationPanel = document.getElementById('calibration-panel');
		
		analysisPanel = document.getElementById('analysis-panel');
		analysisContent = document.getElementById('analysis-content');

        if (!canvas || !ctx) {
            console.error('[App] Canvas не найден!');
            return;
        }

        // Инициализация логгера
        Logger.onEntry = onLogEntry;
        Logger.onPlaybackStart = onPlaybackStart;
        Logger.onPlaybackEnd = onPlaybackEnd;
        Logger.onPlaybackProgress = onPlaybackProgress;

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        initMouseHandlers();
        initTouchHandlers();
        buildAddressCheckboxes();
        loadSettings();
		
		document.addEventListener('click', function(e) {
			if (!e.target.closest('.dropdown')) {
				closeAllDropdowns();
			}
		});
		
		const antennaInfo = document.getElementById('antenna-info');
		if (antennaInfo) {
			antennaInfo.addEventListener('click', function() {
				autoScaleEnabled = true;
				autoScale();
			});
		}
		
		const compassEl = document.getElementById('cfg-compass-mode');
		if (compassEl) compassEl.value = compassMode;
		
		if (!compassMode) compassMode = 'auto';
		
		const savedTheme = parseInt(localStorage.getItem('theme') || '0');
		currentTheme = savedTheme;
		if (currentTheme > 0) {
			document.documentElement.classList.add(themes[currentTheme]);
		}		
		
        loadTopoBinding();
		updateAllButtons();
        updateSettingsUI();
        updateAntennaInfoUI();

        requestAnimationFrame(renderLoop);
        ageTimer = setInterval(tickAll, 1000);
        updateAllButtons();

        console.log('[App] Инициализация завершена');
    }

    // ========== ТАЙМЕР СТАРЕНИЯ ==========
    function tickAll() {
        AZMManager.tickAge();
    }

    // ========== ПОДКЛЮЧЕНИЕ К ПОРТУ ==========
    async function connectSerial() {
        if (serialBridge) {
            console.log('[App] Закрываю предыдущее соединение...');
            try {
                if (AZMManager.getState().isInterrogationActive) {
                    await serialBridge.send(AZMManager.getStopCommand());
                    await sleep(100);
                }
                await serialBridge.close();
            } catch (e) {
                console.warn('[App] Ошибка при закрытии предыдущего:', e.message);
            }
            serialBridge = null;
        }

        try {
            setStatus('Подключение...');

            serialBridge = new SerialBridge();
            serialBridge.onMessage = onSerialMessage;
            serialBridge.onError = onSerialError;
            serialBridge.onClose = onSerialClose;

            await serialBridge.open(9600);
			
			await Logger.startRecording();
			Logger.logInfo('AZM Starting...');

            isConnected = true;
			updateAllButtons();
            connectionIndicator.className = 'connected';
            setStatus('Подключено. Запрос информации...');
            deviceLabel.textContent = 'Zima2 USBL';

            await sleep(500);

            if (serialBridge && serialBridge.isOpen) {
				const cmd = AZMManager.getDINFOCommand();
				Logger.logOutgoing('AZM', cmd.trim());
				await serialBridge.send(cmd);
				console.log('[Serial] →', cmd.trim());
			}

        } catch (err) {
            console.error('[App] Ошибка подключения:', err);

            if (serialBridge) {
                try { await serialBridge.close(); } catch (e) {}
                serialBridge = null;
            }

            isConnected = false;
			updateAllButtons();
            connectionIndicator.className = '';
            setStatus('Ошибка: ' + err.message);
        }
    }

    async function disconnectSerial() {
		setStatus('Отключение...');		

		// Останавливаем запись
		Logger.stopRecording();

		if (serialBridge) {
			try {
				if (AZMManager.getState().isInterrogationActive) {
					const cmd = AZMManager.getStopCommand();
					Logger.logOutgoing('AZM', cmd.trim());
					await serialBridge.send(cmd);
					await sleep(200);
				}
				await serialBridge.close();
			} catch (e) {
				console.warn('[App] Ошибка при закрытии:', e.message);
			}
			serialBridge = null;
		}

		onSerialClose();
		updateAllButtons();

		// Предложить сохранить лог
		const count = Logger.getEntryCount();
		if (count > 10) {
			if (confirm(`Сессия завершена. ${count} записей в логе.\nСохранить лог?`)) {
				await Logger.downloadLog();
			}
		}
	}

    // ========== ОБРАБОТЧИКИ SERIALBRIDGE ==========
    function onSerialMessage(rawLine) {
        const line = rawLine.trim();
        Logger.logIncoming('AZM', line);

        const result = AZMManager.processRawLine(line);
        if (!result) return;

        switch (result.type) {
            case 'dinfo':
                handleDINFO(result.data);
                break;
            case 'strstp':
                handleSTRSTP(result.data);
                break;
            case 'ndta_result':
                updateAntennaInfoUI();
                if (result.beacon) handleBeaconUpdate(result.beacon);
                break;
        }
    }

    function handleDINFO(info) {
        const typeNames = { 0: 'USBL', 1: 'Ответчик', 2: 'LBL' };
        let label = `Zima2 ${typeNames[info.deviceType] || ''}`.trim();
        if (info.serialNumber) label += ` [${info.serialNumber}]`;
        deviceLabel.textContent = label;
        setStatus('Устройство обнаружено. Запуск опроса...');

        loadSettings();

        if (serialBridge && isConnected) {
            const cmd = AZMManager.getStartCommand();
            Logger.logOutgoing('AZM', cmd.trim());
            serialBridge.send(cmd);
            console.log('[Serial] → автостарт опроса');
        }
    }

    function handleSTRSTP(data) {
        const isActive = data.addrMask !== 0;
        if (isActive) {
            setStatus('Опрос активен');
            connectionIndicator.className = 'connected active';
        } else {
            setStatus('Опрос остановлен');
            connectionIndicator.className = 'connected';            
        }
		
		updateAllButtons();
    }

function handleBeaconUpdate(beacon) {
    if (!beacon) return;

    let dist, azm;

    if (!isNaN(beacon.absoluteDistanceM) && !isNaN(beacon.absoluteAzimuthDeg) && beacon.absoluteDistanceM > 0) {
        dist = beacon.absoluteDistanceM;
        azm = beacon.absoluteAzimuthDeg;
    } else if (beacon.dhFilter) {
        return;
    } else if (!isNaN(beacon.slantRangeProjectionM) && !isNaN(beacon.azimuthDeg) && beacon.slantRangeProjectionM > 0) {
        dist = beacon.slantRangeProjectionM;
        azm = beacon.azimuthDeg + (AZMManager.getState().antennaHeadingDeg || 0);
    } else if (!isNaN(beacon.slantRangeM) && !isNaN(beacon.azimuthDeg) && beacon.slantRangeM > 0) {
        dist = beacon.slantRangeM;
        azm = beacon.azimuthDeg + (AZMManager.getState().antennaHeadingDeg || 0);
    }

    // Вычисляем относительные координаты в системе Head-Up
    let xM = NaN, yM = NaN, zM = NaN;
    const st = AZMManager.getState();

    // Если есть топопривязка и абсолютные координаты маяка — через географию
    if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg) && !isNaN(st.antennaHeadingDeg) &&
        !isNaN(beacon.latitudeDeg) && !isNaN(beacon.longitudeDeg)) {
        
		const mlat = (st.antennaLatDeg + beacon.latitudeDeg) / 2 * Math.PI / 180;
		const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
		const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);

		const deltaLatM = (beacon.latitudeDeg - st.antennaLatDeg) * mPerDegLat;
		const deltaLonM = (beacon.longitudeDeg - st.antennaLonDeg) * mPerDegLon;
				
        const headingRad = st.antennaHeadingDeg * Math.PI / 180;
        const cosH = Math.cos(headingRad);
        const sinH = Math.sin(headingRad);
        
        xM = deltaLatM * cosH + deltaLonM * sinH;
        yM = -deltaLatM * sinH + deltaLonM * cosH;
        zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;
    }
    // Если нет топопривязки — через полярные координаты
    else if (!isNaN(dist) && !isNaN(azm) && !isNaN(st.antennaHeadingDeg)) {
        const relativeAzmRad = (azm - st.antennaHeadingDeg) * Math.PI / 180;
        xM = dist * Math.cos(relativeAzmRad);
        yM = dist * Math.sin(relativeAzmRad);
        zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;
    }
    // Если вообще ничего нет
    else {
        zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;
    }

    TrackManager.addPoint(
        beacon.address, dist, azm,
        beacon.latitudeDeg, beacon.longitudeDeg, beacon.depthM,
        beacon.isTimeout,
        xM, yM, zM
    );

    // Калибровка (без изменений)
    if (isCalibrating && !isNaN(beacon.absoluteDistanceM) && !isNaN(beacon.azimuthDeg)) {
        AngularCalibration.addPoint(
            new Date(),
            st.antennaHeadingDeg,
            st.antennaLatDeg,
            st.antennaLonDeg,
            beacon.azimuthDeg,
            beacon.slantRangeProjectionM || beacon.slantRangeM,
            beacon.propTimeS,
            st.antennaDepthM,
            beacon.depthM
        );
        const count = AngularCalibration.getCount();
        const maxPoints = parseInt(document.getElementById('cfg-cal-points')?.value) || 100;
        const statusEl = document.getElementById('cal-status');
        if (statusEl) statusEl.textContent = 'Собрано: ' + count;

        if (count >= maxPoints) {
            stopCalibration();
        }
    }
}

	function onSerialError(error) {
		console.error('[App] Ошибка порта:', error);
		Logger.logError(error.message);
		setStatus('Ошибка порта: ' + error.message);
	}

    function onSerialClose() {
        console.log('[App] Соединение закрыто');
        isConnected = false;
        serialBridge = null;

        connectionIndicator.className = '';
        setStatus('Не подключено');
        deviceLabel.textContent = 'Zima2 USBL'; 

        AZMManager.reset();
		updateAllButtons();
    }
	
	
	async function connectGNSS() {
		if (gnssBridge) {
			try { await gnssBridge.close(); } catch (e) {}
			gnssBridge = null;
		}

		try {
			setStatus('Подключение GNSS...');			

			gnssBridge = new SerialBridge();
			gnssBridge.onMessage = onGnssMessage;
			gnssBridge.onError = (e) => {
				console.error('[GNSS] Ошибка:', e.message);
				Logger.logError('GNSS: ' + e.message);				
			};
			gnssBridge.onClose = () => {
				isGnssConnected = false;
				updateAllButtons();
				Logger.logInfo('GNSS disconnected');
			};

			const saved = localStorage.getItem('zima2_settings');
			const gnssBaud = saved ? (JSON.parse(saved).gnssBaudrate || 38400) : 38400;
			await gnssBridge.open(gnssBaud);

			isGnssConnected = true;
			updateAllButtons();
			Logger.logInfo('GNSS connected at ' + gnssBaud);
			setStatus('GNSS подключен (' + gnssBaud + ')');
		} catch (e) {
			Logger.logError('GNSS: ' + e.message);
			setStatus('Ошибка GNSS: ' + e.message);
			updateAllButtons();
		}
	}

	async function disconnectGNSS() {
		if (gnssBridge) {
			await gnssBridge.close();
			gnssBridge = null;
		}
		isGnssConnected = false;
		updateAllButtons();
	}

	function onGnssMessage(rawLine) {
		
		const line = rawLine.trim();
		Logger.logIncoming('GNSS', line);

		const data = GNSSParser.parse(line);
		if (!data) return;

		const st = AZMManager.getState();

		if (data.type === 'rmc' && !isNaN(data.latitude) && !isNaN(data.longitude)) {
			AZMManager.setAntennaPosition(data.latitude, data.longitude, st.antennaHeadingDeg);
			if (!isNaN(data.speedMps)) AZMManager.setSpeedCourse(data.speedMps, data.course);
			TrackManager.addStationPoint(data.latitude, data.longitude, st.antennaHeadingDeg);
			updateAntennaInfoUI();
			
			if (topoVisible) {
				document.getElementById('topo-lat').value = data.latitude.toFixed(6);
				document.getElementById('topo-lon').value = data.longitude.toFixed(6);
				document.getElementById('topo-gnss-status').textContent = '✓ Внешний GNSS';
				document.getElementById('topo-gnss-status').className = 'locked';
			}
		} else if (data.type === 'hdt' && !isNaN(data.heading)) {
			hasTrueHeading = true;
			if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
				AZMManager.setAntennaPosition(st.antennaLatDeg, st.antennaLonDeg, data.heading);
				updateAntennaInfoUI();
				if (topoVisible) {
					document.getElementById('topo-hdg').value = data.heading.toFixed(1);
				}
			}
		} else if (data.type === 'hdm' && !isNaN(data.heading)) {
			if (shouldUseHeading('hdm')) {
				if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
					AZMManager.setAntennaPosition(st.antennaLatDeg, st.antennaLonDeg, data.heading);
					updateAntennaInfoUI();
					if (topoVisible) {
						document.getElementById('topo-hdg').value = data.heading.toFixed(1);
					}
				}
			}
		}
	}
	
	
	// ========== КАЛИБРОВКА ==========
	function toggleCalibration() {
		if (calibrationPanel.style.display === 'none' || !calibrationPanel.style.display) {
			calibrationPanel.style.display = 'block';
			document.getElementById('cal-status').textContent = 'Собрано: ' + AngularCalibration.getCount();
		} else {
			calibrationPanel.style.display = 'none';
			if (isCalibrating) stopCalibration();  // ОСТАВИТЬ — закрытие панели = стоп
		}
	}

	function startCalibration() {
		AngularCalibration.reset();
		AngularCalibration.setOffsets(
			AZMManager.getState().offsetXM,
			AZMManager.getState().offsetYM
		);
		isCalibrating = true;
		document.getElementById('cal-status').textContent = 'Собрано: 0';
		setStatus('Калибровка начата');
		
		document.getElementById('btn-cal-start').disabled = true;
		document.getElementById('btn-cal-stop').disabled = false;
		document.getElementById('cfg-cal-from').disabled = true;
		document.getElementById('cfg-cal-to').disabled = true;
		document.getElementById('cfg-cal-step').disabled = true;
		document.getElementById('cfg-cal-points').disabled = true;
	}

	function stopCalibration() {
		if (!isCalibrating) return;
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
				
				AZMManager.setAntennaOffsets(
					AZMManager.getState().offsetXM,
					AZMManager.getState().offsetYM,
					phi
				);
				saveSettings();
				setStatus(`Калибровка завершена. φ = ${phi.toFixed(1)}°`);
				document.getElementById('cal-status').textContent = `✓ φ = ${phi.toFixed(1)}°`;
				
				if (isConnected && AZMManager.getState().isInterrogationActive) {
					const cmd = AZMManager.getStartCommand();
					Logger.logOutgoing('AZM', cmd.trim());
					serialBridge.send(cmd);
				}
			} else {
				document.getElementById('cal-status').textContent = 'Отклонено';
				setStatus('Калибровка отклонена');
			}
		} else {
			setStatus('Недостаточно точек для калибровки');
			document.getElementById('cal-status').textContent = 'Недостаточно точек';
		}
	}

    // ========== УПРАВЛЕНИЕ ОПРОСОМ ==========
    async function startInterrogation() {
        if (!serialBridge || !isConnected) {
            setStatus('Нет подключения');
            return;
        }
        const cmd = AZMManager.getStartCommand();
        Logger.logOutgoing('AZM', cmd.trim());
        await serialBridge.send(cmd);
        console.log('[Serial] → старт опроса');
    }

    async function stopInterrogation() {
        if (!serialBridge || !isConnected) {
            setStatus('Нет подключения');
            return;
        }
        const cmd = AZMManager.getStopCommand();
        Logger.logOutgoing('AZM', cmd.trim());
        await serialBridge.send(cmd);
        console.log('[Serial] → стоп опроса');
    }

    // ========== ТОПОПРИВЯЗКА ==========
	function toggleTopoPanel() {
		topoVisible = !topoVisible;
		if (topoVisible) {
			topoPanel.classList.add('visible');
			// Обновить статус GNSS
			const statusEl = document.getElementById('topo-gnss-status');
			if (isGnssConnected) {
				statusEl.textContent = '✓ Внешний GNSS подключен';
				statusEl.className = 'locked';
			} else {
				statusEl.textContent = 'Внешний GNSS не подключен';
				statusEl.className = '';
			}
		} else {
			topoPanel.classList.remove('visible');
		}
	}

    function applyTopoBinding() {
        const lat = parseFloat(document.getElementById('topo-lat').value);
        const lon = parseFloat(document.getElementById('topo-lon').value);
        const hdg = parseFloat(document.getElementById('topo-hdg').value);

        if (isNaN(lat) || isNaN(lon)) {
            alert('Введите координаты (или подключите внешний GNSS)');
            return;
        }
        if (isNaN(hdg)) {
            alert('Введите курс (направление антенны, 0-360°)');
            return;
        }
        if (lat < -90 || lat > 90) { alert('Широта: -90…90'); return; }
        if (lon < -180 || lon > 180) { alert('Долгота: -180…180'); return; }
        if (hdg < 0 || hdg > 360) { alert('Курс: 0…360°'); return; }

        AZMManager.setAntennaPosition(lat, lon, hdg);
        AZMManager.recalcAllBeacons();
        updateAntennaInfoUI();
        saveTopoBinding(lat, lon, hdg);

        topoVisible = false;
        topoPanel.classList.remove('visible');

        setStatus(`Топопривязка: ${lat.toFixed(5)}, ${lon.toFixed(5)}, ${hdg.toFixed(1)}°`);
        updateAllButtons();
    }

    function clearTopoBinding() {
        AZMManager.setAntennaPosition(NaN, NaN, NaN);
        updateAntennaInfoUI();
        try { localStorage.removeItem('topo_binding'); } catch (e) {}
        setStatus('Топопривязка сброшена');

        if (topoVisible) toggleTopoPanel();
        updateAllButtons();
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
                    AZMManager.setAntennaPosition(data.lat, data.lon, data.hdg);
                    updateAntennaInfoUI();
                    setStatus(`Загружена привязка: ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}, ${data.hdg.toFixed(1)}°`);
                }
            }
        } catch (e) {}
    }

	function updateAntennaInfoUI() {
		const st = AZMManager.getState();
		document.getElementById('ai-lat').textContent = isNaN(st.antennaLatDeg) ? '--' : st.antennaLatDeg.toFixed(6);
		document.getElementById('ai-lon').textContent = isNaN(st.antennaLonDeg) ? '--' : st.antennaLonDeg.toFixed(6);
		document.getElementById('ai-hdg').textContent = isNaN(st.antennaHeadingDeg) ? '--' : st.antennaHeadingDeg.toFixed(1);
		document.getElementById('ai-spd').textContent = isNaN(st.speedMps) ? '--' : st.speedMps.toFixed(2);
		document.getElementById('ai-crs').textContent = isNaN(st.courseDeg) ? '--' : st.courseDeg.toFixed(1);
		document.getElementById('ai-dpt').textContent = isNaN(st.antennaDepthM) ? '--' : st.antennaDepthM.toFixed(1);
		document.getElementById('ai-tmp').textContent = isNaN(st.waterTempC) ? '--' : st.waterTempC.toFixed(1);
		document.getElementById('ai-pitch').textContent = isNaN(st.antennaPitchDeg) ? '--' : st.antennaPitchDeg.toFixed(1);
		document.getElementById('ai-roll').textContent = isNaN(st.antennaRollDeg) ? '--' : st.antennaRollDeg.toFixed(1);
	}

	function updateAllButtons() {
		const st = AZMManager.getState();

		// Кнопка подключения AZM
		if (isConnected) {
			btnConnection.textContent = '⏏ AZM';
			btnConnection.className = 'top-btn btn-disconnect';
		} else {
			btnConnection.textContent = '🔌 AZM';
			btnConnection.className = 'top-btn btn-connect';
		}

		// Кнопка GNSS
		if (isGnssConnected) {
			btnGnss.textContent = '⏏ GNSS';
			btnGnss.style.background = '#dc3545';
		} else {
			btnGnss.textContent = '📡 GNSS';
			btnGnss.style.background = '#8e44ad';
		}

		// Кнопка опроса
		if (isConnected && st.isDeviceInfoValid) {
			btnInterrogation.disabled = false;
			if (st.isInterrogationActive) {
				btnInterrogation.textContent = '⏸ Стоп';
				btnInterrogation.className = 'top-btn btn-stop';
			} else {
				btnInterrogation.textContent = '▶ Опрос';
				btnInterrogation.className = 'top-btn btn-start';
			}
		} else {
			btnInterrogation.disabled = true;
			btnInterrogation.textContent = '▶ Опрос';
			btnInterrogation.className = 'top-btn btn-start';
		}
	}

	function toggleConnection() {
		if (isConnected) {
			disconnectSerial();
		} else {
			connectSerial();
		}
	}

	function toggleGNSS() {
		if (isGnssConnected) {
			disconnectGNSS();
		} else {
			connectGNSS();
		}
	}

	function toggleInterrogation() {
		if (AZMManager.getState().isInterrogationActive) {
			stopInterrogation();
		} else {
			startInterrogation();
		}
	}


    // ========== НАСТРОЙКИ ==========
    function openSettings() {
        settingsVisible = true;
        settingsOverlay.classList.add('visible');
        updateSettingsUI();
    }

    function closeSettings() {
        settingsVisible = false;
        settingsOverlay.classList.remove('visible');
    }

    function updateSettingsUI() {
        const st = AZMManager.getState();
        const trs = TrackManager.getSettings();

        document.getElementById('cfg-mask').value = st.addressMask;
        document.getElementById('cfg-maxdist').value = st.maxDistM;
        document.getElementById('cfg-salinity').value = st.salinityPSU;
        const sosInput = document.getElementById('cfg-soundspeed');
		if (sosInput) {
			sosInput.value = (!isNaN(st.soundSpeedMps) && !st.soundSpeedAuto) ? st.soundSpeedMps.toFixed(1) : '';
		}
        document.getElementById('cfg-offsetx').value = st.offsetXM;
        document.getElementById('cfg-offsety').value = st.offsetYM;
        document.getElementById('cfg-phi').value = st.phiDeg;
        document.getElementById('cfg-maxpoints').value = trs.maxPointsPerTrack;
        document.getElementById('cfg-minpointdist').value = trs.minPointDistanceM;
		
		const gnssBaudEl = document.getElementById('cfg-gnss-baud');
		if (gnssBaudEl) {
			const saved = localStorage.getItem('zima2_settings');
			if (saved) {
				const data = JSON.parse(saved);
				gnssBaudEl.value = data.gnssBaudrate || '38400';
			}
		}
		
		const compassEl = document.getElementById('cfg-compass-mode');
		if (compassEl) compassEl.value = compassMode;

        syncCheckboxesFromMask();
    }

    function applySettings() {
        const mask = parseInt(document.getElementById('cfg-mask').value) || 1;
        const maxDist = parseFloat(document.getElementById('cfg-maxdist').value) || 1000;
        const salinity = parseFloat(document.getElementById('cfg-salinity').value) || 0;
		
		const soundSpeedVal = document.getElementById('cfg-soundspeed').value;
		const soundSpeed = soundSpeedVal ? parseFloat(soundSpeedVal) : NaN;
		
        const offsX = parseFloat(document.getElementById('cfg-offsetx').value) || 0;
        const offsY = parseFloat(document.getElementById('cfg-offsety').value) || 0;
        const phi = parseFloat(document.getElementById('cfg-phi').value) || 0;
        const maxPoints = parseInt(document.getElementById('cfg-maxpoints').value) || 500;
        const minDist = parseFloat(document.getElementById('cfg-minpointdist').value) || 0.5;
		
		const newCompassMode = document.getElementById('cfg-compass-mode')?.value;
		if (newCompassMode) {
			compassMode = newCompassMode;
			if (compassMode !== 'auto') hasTrueHeading = false;
		}

        AZMManager.setAddressMask(mask);
        AZMManager.setMaxDistance(maxDist);
        AZMManager.setSalinity(salinity);
        AZMManager.setSoundSpeedAuto(isNaN(soundSpeed));  // пусто = авто
		if (!isNaN(soundSpeed)) AZMManager.setSoundSpeed(soundSpeed);
        AZMManager.setAntennaOffsets(offsX, offsY, phi);

        TrackManager.setMaxPoints(maxPoints);
        TrackManager.setMinDistance(minDist);

        saveSettings();

        if (isConnected && AZMManager.getState().isInterrogationActive) {
            const cmd = AZMManager.getStartCommand();
            Logger.logOutgoing('AZM', cmd.trim());
            serialBridge.send(cmd);
        }

        closeSettings();
        setStatus('Настройки применены');
    }

    function onMaskChanged() { syncCheckboxesFromMask(); }

    function buildAddressCheckboxes() {
        const container = document.getElementById('addr-checkboxes');
        if (!container) return;

        let html = '';
        for (let addr = 0; addr < 16; addr++) {
            html += `
                <label id="aclbl_${addr}">
                    <input type="checkbox" value="${addr}" onchange="App.onAddrCheckboxChanged()">
                    ${addr + 1}
                </label>`;
        }
        container.innerHTML = html;
    }

    function syncCheckboxesFromMask() {
        const maskInput = document.getElementById('cfg-mask');
        if (!maskInput) return;
        const mask = parseInt(maskInput.value) || 0;

        for (let addr = 0; addr < 16; addr++) {
            const cb = document.querySelector(`#aclbl_${addr} input`);
            const lbl = document.getElementById(`aclbl_${addr}`);
            if (cb) {
                const bit = 1 << addr;
                cb.checked = (mask & bit) !== 0;
                if (lbl) lbl.classList.toggle('checked', cb.checked);
            }
        }
    }

    function onAddrCheckboxChanged() {
        let mask = 0;
        for (let addr = 0; addr < 16; addr++) {
            const cb = document.querySelector(`#aclbl_${addr} input`);
            if (cb && cb.checked) mask |= 1 << addr;
            const lbl = document.getElementById(`aclbl_${addr}`);
            if (lbl) lbl.classList.toggle('checked', cb && cb.checked);
        }
        document.getElementById('cfg-mask').value = mask;
    }

	function saveSettings() {
		const data = {
			mask: AZMManager.getState().addressMask,
			maxDist: AZMManager.getState().maxDistM,
			salinity: AZMManager.getState().salinityPSU,
			soundSpeedAuto: AZMManager.getState().soundSpeedAuto,
			soundSpeed: AZMManager.getState().soundSpeedMps,
			offsetX: AZMManager.getState().offsetXM,
			offsetY: AZMManager.getState().offsetYM,
			phi: AZMManager.getState().phiDeg,
			maxTrackPoints: TrackManager.getSettings().maxPointsPerTrack,
			minPointDist: TrackManager.getSettings().minPointDistanceM,
			gnssBaudrate: parseInt(document.getElementById('cfg-gnss-baud')?.value) || 38400,
			compassMode: compassMode,
		};
		try { localStorage.setItem('zima2_settings', JSON.stringify(data)); } catch (e) {}
	}

	function loadSettings() {
		try {
			const saved = localStorage.getItem('zima2_settings');
			if (saved) {
				const data = JSON.parse(saved);
				if (data.mask !== undefined) AZMManager.setAddressMask(data.mask);
				if (data.maxDist !== undefined) AZMManager.setMaxDistance(data.maxDist);
				if (data.salinity !== undefined) AZMManager.setSalinity(data.salinity);
				if (data.soundSpeedAuto !== undefined) AZMManager.setSoundSpeedAuto(data.soundSpeedAuto);
				if (data.soundSpeed !== undefined) AZMManager.setSoundSpeed(data.soundSpeed);
				if (data.offsetX !== undefined && data.offsetY !== undefined && data.phi !== undefined) {
					AZMManager.setAntennaOffsets(data.offsetX, data.offsetY, data.phi);
				}
				if (data.maxTrackPoints !== undefined) TrackManager.setMaxPoints(data.maxTrackPoints);
				if (data.minPointDist !== undefined) TrackManager.setMinDistance(data.minPointDist);
				if (data.gnssBaudrate !== undefined && document.getElementById('cfg-gnss-baud')) {
					document.getElementById('cfg-gnss-baud').value = data.gnssBaudrate;
				}
				if (data.compassMode) { 
				    compassMode = data.compassMode; 
					const el = document.getElementById('cfg-compass-mode'); 
					if (el) 
						el.value = data.compassMode; 
				}
			}
		} catch (e) {}
	}

    // ========== ЛОГГЕР ==========
    function saveLog() {
        if (Logger.getEntryCount() === 0) {
            alert('Нет данных для сохранения');
            return;
        }
        Logger.downloadLog();
        setStatus('Лог сохранён');
    }

	async function loadLog() {
		closeAllDropdowns();
		
		// Если идёт воспроизведение — останавливаем
		if (Logger.getRecordingStatus().isPlaying) {
			Logger.stopPlayback();
			onPlaybackEnd();
		}

		try {
			const count = await Logger.loadLogFromFile();
			if (count > 0) {
				setStatus(`Загружено ${count} записей`);
			}
		} catch (e) {
			console.error('[App] Ошибка загрузки лога:', e);
		}
	}

	function togglePlayback() {
		closeAllDropdowns();

		if (Logger.getRecordingStatus().isPlaying) {
			Logger.stopPlayback();
			onPlaybackEnd();
			return;
		}

		if (Logger.getEntries().length === 0) {
			alert('Нет загруженного лога. Откройте файл лога через 📂 Открыть.');
			return;
		}

		// Блокируем кнопки подключения
		btnConnection.disabled = true;
		btnGnss.disabled = true;

		Logger.startPlayback(1.0, true);
		playbackProgress.style.display = 'block';
		if (serialBridge) serialBridge.onMessage = null;

		// Меняем пункты меню
		document.getElementById('log-play-item').style.display = 'none';
		document.getElementById('log-stop-item').style.display = 'block';
		document.getElementById('log-load-item').style.opacity = '0.4';
		document.getElementById('log-load-item').style.pointerEvents = 'none';
	}
	
	function shouldUseHeading(type) {
		switch (compassMode) {
			case 'hdt': return type === 'hdt';
			case 'magnetic': return type === 'hdm';
			case 'auto':
			default:
				if (type === 'hdt') { hasTrueHeading = true; return true; }
				if (type === 'hdm') return !hasTrueHeading;
				return false;
		}
	}

	function onLogEntry(data, timestampMs, virtualTime, logEntry) {
		// Игнорируем исходящие строки
		if (logEntry && logEntry.type === 'outgoing') return;
		
		// Игнорируем OUT порты
		if (logEntry && logEntry.port) {
			const p = logEntry.port.toUpperCase();
			if (p.includes('OUT')) return;
		}

		// Пробуем парсить как GNSS
		const gnssData = GNSSParser.parse(data);
		if (gnssData) {
			AZMManager.setTimeProvider(() => virtualTime);
			
			const st = AZMManager.getState();

			if (gnssData.type === 'rmc' && !isNaN(gnssData.latitude) && !isNaN(gnssData.longitude)) {
				AZMManager.setAntennaPosition(gnssData.latitude, gnssData.longitude, st.antennaHeadingDeg);
				if (!isNaN(gnssData.speedMps)) AZMManager.setSpeedCourse(gnssData.speedMps, gnssData.course);
				TrackManager.addStationPoint(gnssData.latitude, gnssData.longitude, AZMManager.getState().antennaHeadingDeg);
				updateAntennaInfoUI();
			} else if (gnssData.type === 'hdt' && !isNaN(gnssData.heading)) {
				hasTrueHeading = true;
				if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
					AZMManager.setAntennaPosition(st.antennaLatDeg, st.antennaLonDeg, gnssData.heading);
					updateAntennaInfoUI();
				}
			} else if (gnssData.type === 'hdm' && !isNaN(gnssData.heading)) {
				if (shouldUseHeading('hdm')) {
					if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
						AZMManager.setAntennaPosition(st.antennaLatDeg, st.antennaLonDeg, gnssData.heading);
						updateAntennaInfoUI();
					}
				}
			}
			return;
		}

		// Не GNSS — обрабатываем как данные Zima
		AZMManager.setTimeProvider(() => virtualTime);
		const result = AZMManager.processRawLine(data);

		if (result) {
			switch (result.type) {
				case 'dinfo':
					handleDINFO(result.data);
					break;
				case 'strstp':
					handleSTRSTP(result.data);
					break;
				case 'ndta_result':
					updateAntennaInfoUI();
					if (result.beacon) handleBeaconUpdate(result.beacon);
					break;
			}
		}
	}

    function onPlaybackStart() {
        setStatus('▶ Воспроизведение...');
    }

	function onPlaybackEnd() {
		AZMManager.setTimeProvider(() => new Date());
		playbackProgress.style.display = 'none';

		if (serialBridge && isConnected) {
			serialBridge.onMessage = onSerialMessage;
		}

		btnConnection.disabled = false;
		btnGnss.disabled = false;
		updateAllButtons();

		// Возвращаем пункты меню
		document.getElementById('log-play-item').style.display = 'block';
		document.getElementById('log-stop-item').style.display = 'none';
		document.getElementById('log-load-item').style.opacity = '1';
		document.getElementById('log-load-item').style.pointerEvents = 'auto';

		setStatus('Воспроизведение завершено');
	}

    function onPlaybackProgress(current, total) {
        if (playbackProgressFill) {
            const pct = total > 0 ? (current / total * 100) : 0;
            playbackProgressFill.style.width = pct + '%';
        }
    }

    // ========== ТРЕКИ ==========
    function toggleTracks() {
        const visible = TrackManager.toggleShowTracks();
        btnTracksShow.textContent = visible ? '📐 Треки' : '📐 Скрыты';
        btnTracksShow.classList.toggle('active', visible);
    }

    function clearTracks() {
        if (confirm('Очистить все треки маяков?')) {
            TrackManager.clearAll();
			TrackManager.clearStationTrack();
            setStatus('Треки очищены');
        }
    }

    function exportTracksKML() {
        const trackCount = TrackManager.getTrackedAddresses().length;
        if (trackCount === 0) {
            alert('Нет данных треков для экспорта');
            return;
        }
        TrackManager.downloadKML();
        setStatus(`KML экспортирован (${trackCount} треков)`);
    }

    // ========== ОТРИСОВКА ==========
    function resizeCanvas() {
        const w = mapContainer.clientWidth;
        const h = mapContainer.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            if (offsetX === 0 && offsetY === 0) {
                offsetX = w / 2;
                offsetY = h / 2;
            }
        }
    }

    function renderLoop() {
        drawAll();
        requestAnimationFrame(renderLoop);
    }

	function drawAll() {
		if (!ctx || canvas.width === 0) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		drawGrid();
		TrackManager.drawStationTrack(ctx, offsetX, offsetY, scale);
		TrackManager.drawTracks(ctx, offsetX, offsetY, scale);
		drawBeacons();
		drawAntenna();
		drawScaleBar();

		const beacons = AZMManager.getBeaconsArray();
		const hash = beacons.map(b => `${b.address}:${b.dataAge}:${b.isTimeout}:${b.absoluteDistanceM?.toFixed(0)}:${b.absoluteAzimuthDeg?.toFixed(0)}`).join('|');

		if (hash !== lastBeaconsHash) {
			updateBeaconsBar();
			lastBeaconsHash = hash;
		}
	}
	
	// Вспомогательная функция — добавить в app.js перед drawGrid
	function getCanvasColors() {
		const isLight = document.documentElement.classList.contains('theme-light');
		if (isLight) {
			return {
				text: '#1a1a1a',
				textSecondary: 'rgba(0,0,0,0.7)',
				stroke: '#1a1a1a',
			};
		} else {
			return {
				text: '#fff',
				textSecondary: 'rgba(255,255,255,0.8)',
				stroke: '#fff',
			};
		}
	}

	function drawGrid() {
		const gridSize = 50;
		const cc = getCanvasColors();
		const isLight = document.documentElement.classList.contains('theme-light');
		const isDarkContrast = document.documentElement.classList.contains('theme-dark-contrast');
		
		let gridColor, axisColor;
		if (isLight) {
			gridColor = 'rgba(0, 0, 0, 0.08)';
			axisColor = 'rgba(0, 0, 0, 0.2)';
		} else if (isDarkContrast) {
			gridColor = 'rgba(255, 255, 255, 0.12)';
			axisColor = 'rgba(255, 255, 255, 0.35)';
		} else {
			gridColor = 'rgba(255, 255, 255, 0.06)';
			axisColor = 'rgba(255, 255, 255, 0.2)';
		}
		
		// Центр сетки = позиция антенны
		const st = AZMManager.getState();
		let cx = offsetX, cy = offsetY;
		if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
			const anchor = TrackManager.getAnchor();
			if (!isNaN(anchor.lat)) {
				const mlat = (st.antennaLatDeg + anchor.lat) / 2 * Math.PI / 180;
				const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
				const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
				cx = offsetX + (st.antennaLonDeg - anchor.lon) * mPerDegLon * scale;
				cy = offsetY - (st.antennaLatDeg - anchor.lat) * mPerDegLat * scale;
			}
		}

		ctx.strokeStyle = gridColor;
		ctx.lineWidth = 1;

		const startX = ((cx % gridSize) + gridSize) % gridSize;
		for (let x = startX; x < canvas.width; x += gridSize) {
			ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
		}
		const startY = ((cy % gridSize) + gridSize) % gridSize;
		for (let y = startY; y < canvas.height; y += gridSize) {
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
		}

		ctx.strokeStyle = axisColor;
		ctx.lineWidth = 2;
		ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy); ctx.stroke();
	}

	function drawAntenna() {
		const st = AZMManager.getState();
		const cc = getCanvasColors();
		
		// Позиция антенны: (0,0) если нет GNSS, иначе метры от якоря
		let ax = offsetX, ay = offsetY;
		if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
			const anchor = TrackManager.getAnchor();
			if (!isNaN(anchor.lat)) {
				const mlat = (st.antennaLatDeg + anchor.lat) / 2 * Math.PI / 180;
				const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
				const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
				const dx = (st.antennaLonDeg - anchor.lon) * mPerDegLon;
				const dy = (st.antennaLatDeg - anchor.lat) * mPerDegLat;
				ax = offsetX + dx * scale;
				ay = offsetY - dy * scale;
			}
		}

		// Ромб
		ctx.beginPath();
		ctx.moveTo(ax, ay - 18);
		ctx.lineTo(ax + 18, ay);
		ctx.lineTo(ax, ay + 18);
		ctx.lineTo(ax - 18, ay);
		ctx.closePath();
		ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
		ctx.fill();
		ctx.strokeStyle = cc.stroke;
		ctx.lineWidth = 2;
		ctx.stroke();

		// Курс
		const hdg = st.antennaHeadingDeg;
		if (!isNaN(hdg)) {
			const ang = hdg * Math.PI / 180;
			const hx = ax + 35 * Math.sin(ang);
			const hy = ay - 35 * Math.cos(ang);
			ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy);
			ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 3; ctx.stroke();
			ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 2 * Math.PI);
			ctx.fillStyle = '#ff4444'; ctx.fill();
		}

		ctx.fillStyle = cc.text;
		ctx.font = 'bold 11px Arial';
		ctx.textAlign = 'center';
		ctx.fillText('АНТ', ax, ay - 26);
	}

	function drawBeacons() {
		const beacons = AZMManager.getBeaconsArray();
		if (!beacons || beacons.length === 0) return;

		if (autoScaleEnabled && beacons.some(b => !isNaN(b.absoluteDistanceM) || !isNaN(b.slantRangeM))) {
			autoScale();
		}

		const cc = getCanvasColors();
		const anchor = TrackManager.getAnchor();

		beacons.forEach(b => {
			let x, y, dist, azm;

			// Приоритет: абсолютные координаты через якорь → полярные от антенны
			if (!isNaN(b.latitudeDeg) && !isNaN(b.longitudeDeg) && !isNaN(anchor.lat)) {
				const mlat = (b.latitudeDeg + anchor.lat) / 2 * Math.PI / 180;
				const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
				const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
				x = offsetX + (b.longitudeDeg - anchor.lon) * mPerDegLon * scale;
				y = offsetY - (b.latitudeDeg - anchor.lat) * mPerDegLat * scale;
				dist = NaN;
				azm = NaN;
			} else if (!isNaN(b.absoluteDistanceM) && !isNaN(b.absoluteAzimuthDeg) && b.absoluteDistanceM > 0) {
				dist = b.absoluteDistanceM;
				azm = b.absoluteAzimuthDeg;
			} else if (!isNaN(b.slantRangeProjectionM) && !isNaN(b.azimuthDeg) && b.slantRangeProjectionM > 0) {
				dist = b.slantRangeProjectionM;
				azm = b.azimuthDeg + (AZMManager.getState().antennaHeadingDeg || 0);
			} else if (!isNaN(b.slantRangeM) && !isNaN(b.azimuthDeg) && b.slantRangeM > 0) {
				dist = b.slantRangeM;
				azm = b.azimuthDeg + (AZMManager.getState().antennaHeadingDeg || 0);
			} else {
				return;
			}

			if (isNaN(x) || isNaN(y)) {
				const ang = azm * Math.PI / 180;
				x = offsetX + dist * Math.sin(ang) * scale;
				y = offsetY - dist * Math.cos(ang) * scale;
			}

			if (isNaN(x) || isNaN(y)) return;

			const age = b.dataAge || 0;
			let alpha = age > 10 ? 0.25 : age > 5 ? 0.55 : 1.0;
			if (b.isTimeout) alpha = 0.2;
			const hue = (b.address * 60) % 360;

			ctx.beginPath();
			ctx.arc(x, y, 15, 0, 2 * Math.PI);
			ctx.fillStyle = `hsla(${hue}, 80%, 55%, ${alpha})`;
			ctx.fill();
			ctx.strokeStyle = cc.stroke;
			ctx.lineWidth = 2;
			ctx.stroke();

			ctx.fillStyle = cc.text;
			ctx.font = 'bold 12px Arial';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText((b.userAddress || b.address + 1).toString(), x, y);

			const displayDist = !isNaN(b.absoluteDistanceM) && b.absoluteDistanceM > 0 ? b.absoluteDistanceM
				: !isNaN(b.slantRangeProjectionM) && b.slantRangeProjectionM > 0 ? b.slantRangeProjectionM
				: !isNaN(b.slantRangeM) && b.slantRangeM > 0 ? b.slantRangeM
				: 0;

			ctx.font = '9px Arial';
			ctx.fillStyle = cc.textSecondary;
			ctx.fillText(`${displayDist.toFixed(0)}м`, x, y + 26);

			if (!isNaN(b.msrDB)) {
				ctx.font = '8px Arial';
				ctx.fillStyle = cc.textSecondary;
				ctx.fillText(`${b.msrDB.toFixed(0)}dB`, x, y + 36);
			}

			if (b.isTimeout) {
				ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#dc3545';
				ctx.fillText('✕', x + 15, y - 17);
			} else if (age > 8) {
				ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#ffc107';
				ctx.fillText('!', x + 15, y - 17);
			}
		});
	}

	function autoScale() {
		const beacons = AZMManager.getBeaconsArray();
		const anchor = TrackManager.getAnchor();
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		let found = false;

		// Трек станции
		const st = AZMManager.getState();
		if (!isNaN(st.antennaLatDeg) && !isNaN(anchor.lat)) {
			const mlat = (st.antennaLatDeg + anchor.lat) / 2 * Math.PI / 180;
			const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
			const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
			const sx = (st.antennaLonDeg - anchor.lon) * mPerDegLon;
			const sy = (st.antennaLatDeg - anchor.lat) * mPerDegLat;
			minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
			minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
			found = true;
		}

		// Маяки
		beacons.forEach(b => {
			let wx, wy;

			if (!isNaN(b.latitudeDeg) && !isNaN(b.longitudeDeg) && !isNaN(anchor.lat)) {
				const mlat = (b.latitudeDeg + anchor.lat) / 2 * Math.PI / 180;
				const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * mlat) + 1.175 * Math.cos(4 * mlat);
				const mPerDegLon = 111412.84 * Math.cos(mlat) - 93.5 * Math.cos(3 * mlat);
				wx = (b.longitudeDeg - anchor.lon) * mPerDegLon;
				wy = (b.latitudeDeg - anchor.lat) * mPerDegLat;
			} else if (!isNaN(b.absoluteDistanceM) && !isNaN(b.absoluteAzimuthDeg) && b.absoluteDistanceM > 0) {
				const a = b.absoluteAzimuthDeg * Math.PI / 180;
				wx = b.absoluteDistanceM * Math.sin(a);
				wy = b.absoluteDistanceM * Math.cos(a);
			} else if (!isNaN(b.slantRangeProjectionM) && !isNaN(b.azimuthDeg) && b.slantRangeProjectionM > 0) {
				const a = (b.azimuthDeg + (st.antennaHeadingDeg || 0)) * Math.PI / 180;
				wx = b.slantRangeProjectionM * Math.sin(a);
				wy = b.slantRangeProjectionM * Math.cos(a);
			} else if (!isNaN(b.slantRangeM) && !isNaN(b.azimuthDeg) && b.slantRangeM > 0) {
				const a = (b.azimuthDeg + (st.antennaHeadingDeg || 0)) * Math.PI / 180;
				wx = b.slantRangeM * Math.sin(a);
				wy = b.slantRangeM * Math.cos(a);
			} else {
				return;
			}

			if (!isNaN(wx) && !isNaN(wy)) {
				minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
				minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
				found = true;
			}
		});

		if (!found) return;

		const pad = 0.35;
		const rx = (maxX - minX) || 100;
		const ry = (maxY - minY) || 100;
		minX -= rx * pad; maxX += rx * pad;
		minY -= ry * pad; maxY += ry * pad;

		const sx = canvas.width / (maxX - minX);
		const sy = canvas.height / (maxY - minY);
		scale = Math.min(sx, sy);
		scale = Math.min(Math.max(scale, 0.1), 5000);
		offsetX = canvas.width / 2 - ((minX + maxX) / 2) * scale;
		offsetY = canvas.height / 2 + ((minY + maxY) / 2) * scale;
	}

    function drawScaleBar() {
		const rawM = 100 / scale;
		const nice = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];
		let dm = nice.find(n => n >= rawM) || Math.round(rawM / 1000) * 1000;
		let dp = dm * scale;
		const maxW = canvas.width - 60;
		if (dp > maxW) { dp = maxW; dm = Math.round(dp / scale); }

		const bx = canvas.width - dp - 30;
		const by = canvas.height - 25;
		
		const cc = getCanvasColors();
		
		ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dp, by);
		ctx.strokeStyle = cc.stroke; ctx.lineWidth = 3; ctx.stroke();
		ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by + 6); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(bx + dp, by - 6); ctx.lineTo(bx + dp, by + 6); ctx.stroke();
		
		ctx.font = 'bold 11px Arial'; ctx.fillStyle = cc.text; ctx.textAlign = 'center';
		ctx.shadowColor = document.documentElement.classList.contains('theme-light') ? 'rgba(255,255,255,0.8)' : '#000';
		ctx.shadowBlur = 4;
		ctx.fillText(dm >= 1000 ? `${(dm / 1000).toFixed(1)} км` : `${Math.round(dm)} м`, bx + dp / 2, by - 12);
		ctx.shadowBlur = 0;
	}

    function updateBeaconsBar() {
		
        const beacons = AZMManager.getBeaconsArray();
        if (!beacons || beacons.length === 0) {
            beaconsBar.classList.add('empty');
            beaconsBar.innerHTML = '';
            return;
        }
        beaconsBar.classList.remove('empty');

        let html = '';
        beacons.forEach(b => {
			const age = b.dataAge || 0;
			let ageClass = age > 20 ? 'stale' : age > 10 ? 'old' : 'fresh';
			let cardClass = b.isTimeout ? 'timeout' : '';

			const userAddr = b.userAddress || b.address + 1;
			const range = !isNaN(b.absoluteDistanceM) ? b.absoluteDistanceM.toFixed(1) + ' м'
				: !isNaN(b.slantRangeProjectionM) ? b.slantRangeProjectionM.toFixed(1) + ' м'
				: !isNaN(b.slantRangeM) ? b.slantRangeM.toFixed(1) + ' м' : '--';
			const azm = !isNaN(b.absoluteAzimuthDeg) ? b.absoluteAzimuthDeg.toFixed(1) + '°'
				: !isNaN(b.azimuthDeg) ? b.azimuthDeg.toFixed(1) + '°' : '--';

			html += `
			<div class="beacon-card ${cardClass}" onclick="App.onBeaconCardClick(${b.address})">
				<div class="bc-addr">#${userAddr}</div>
				<div class="bc-range">📏 ${range}  🌊 ${!isNaN(b.depthM) ? b.depthM.toFixed(1) + 'м' : '--'}</div>
				<div class="bc-azimuth">🧭 ${azm}</div>
				<div class="bc-msr">📶 ${!isNaN(b.msrDB) ? b.msrDB.toFixed(1) + ' dB' : '--'}</div>
				<div class="bc-vcc">🔋 ${!isNaN(b.vccV) ? b.vccV.toFixed(1) + ' V' : '--'}</div>
				<div class="bc-coords">${!isNaN(b.latitudeDeg) ? b.latitudeDeg.toFixed(6) : '--'}, ${!isNaN(b.longitudeDeg) ? b.longitudeDeg.toFixed(6) : '--'}</div>
				<div class="bc-age ${ageClass}">⏱ ${age.toFixed(0)}с${b.isTimeout ? ' ⌛' : ''}</div>
			</div>`;
		});
        beaconsBar.innerHTML = html;
    }

	function onBeaconCardClick(address) {
		
		const b = AZMManager.getBeacons()[address];
		if (!b) return;

		// Включаем автоскейл — маяк гарантированно станет виден
		autoScaleEnabled = true;
		autoScale();
	}

    // ========== МЫШЬ И ТАЧ ==========
    function initMouseHandlers() {
        canvas.addEventListener('wheel', (e) => {
			e.preventDefault();
			
			const rect = canvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			
			const worldX = (mx - offsetX) / scale;
			const worldY = (offsetY - my) / scale;
			
			scale *= e.deltaY > 0 ? 0.85 : 1.18;
			scale = Math.min(Math.max(scale, 0.1), 5000);
			
			offsetX = mx - worldX * scale;
			offsetY = my + worldY * scale;
			
			autoScaleEnabled = false;
		});

        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            lastMouseX = e.clientX; lastMouseY = e.clientY;
            canvas.style.cursor = 'grabbing';
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            offsetX += e.clientX - lastMouseX;
            offsetY += e.clientY - lastMouseY;
            lastMouseX = e.clientX; lastMouseY = e.clientY;
            autoScaleEnabled = false;
        });

        canvas.addEventListener('mouseup', () => { isDragging = false; canvas.style.cursor = 'grab'; });
        canvas.addEventListener('mouseleave', () => { isDragging = false; canvas.style.cursor = 'grab'; });

        canvas.addEventListener('dblclick', () => {
            scale = 100;
            offsetX = canvas.width / 2;
            offsetY = canvas.height / 2;
            autoScaleEnabled = true;
        });
    }

    function initTouchHandlers() {
        let initDist = 0, initScale = scale;

        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                isDragging = true;
                lastMouseX = e.touches[0].clientX;
                lastMouseY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                isDragging = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initDist = Math.sqrt(dx * dx + dy * dy);
                initScale = scale;
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && isDragging) {
                offsetX += e.touches[0].clientX - lastMouseX;
                offsetY += e.touches[0].clientY - lastMouseY;
                lastMouseX = e.touches[0].clientX;
                lastMouseY = e.touches[0].clientY;
                autoScaleEnabled = false;
            } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (initDist > 0) {
                    scale = Math.min(Math.max(initScale * (dist / initDist), 0.1), 5000);
                    autoScaleEnabled = false;
                }
            }
        });

        canvas.addEventListener('touchend', () => { isDragging = false; });
    }

    // ========== ЗАКРЫТИЕ СТРАНИЦЫ ==========
    window.addEventListener('beforeunload', async () => {
        console.log('[App] Закрытие страницы, освобождаю порт...');
		
		if (gnssBridge) {
			try { await gnssBridge.close(); } catch (err) {}
			gnssBridge = null;
		}
		
        if (serialBridge) {
            try {
                if (AZMManager.getState().isInterrogationActive) {
                    await serialBridge.send(AZMManager.getStopCommand());
                }
                await serialBridge.close();
            } catch (err) {}
            serialBridge = null;
        }
        if (ageTimer) clearInterval(ageTimer);
    });

	// ========== ЭКСПОРТ ==========
	function exportCSV() {
		const allTracks = TrackManager.getAll();
		const stTrack = TrackManager.stationTrack;
		
		if (Object.keys(allTracks).length === 0 && stTrack.length === 0) {
			alert('Нет данных треков');
			return;
		}

		const lines = ['time,type,address,latitude,longitude,depth_m,distance_m,azimuth_deg,msr_db,vcc_v,speed_mps,course_deg'];
		
		// Трек станции
		for (const point of stTrack) {
			const ts = new Date(point.ts).toISOString();
			const lat = (point.lat != null && !isNaN(point.lat)) ? point.lat.toFixed(6) : '';
			const lon = (point.lon != null && !isNaN(point.lon)) ? point.lon.toFixed(6) : '';
			lines.push(`${ts},STATION,,${lat},${lon},,,,,,`);
		}
		
		// Треки маяков
		for (const addr of Object.keys(allTracks)) {
			for (const point of allTracks[addr]) {
				if (point.isTimeout) continue;
				const ts = new Date(point.ts).toISOString();
				const lat = (point.lat != null && !isNaN(point.lat)) ? point.lat.toFixed(6) : '';
				const lon = (point.lon != null && !isNaN(point.lon)) ? point.lon.toFixed(6) : '';
				const dpt = !isNaN(point.dpt) ? point.dpt.toFixed(1) : '';
				const dist = !isNaN(point.dist) ? point.dist.toFixed(1) : '';
				const azm = !isNaN(point.azm) ? point.azm.toFixed(1) : '';
				lines.push(`${ts},BEACON,${parseInt(addr)+1},${lat},${lon},${dpt},${dist},${azm},,,,`);
			}
		}

		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = `zima2_tracks_${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.csv`;
		document.body.appendChild(a); a.click();
		document.body.removeChild(a); URL.revokeObjectURL(url);
	}

	function exportGGA() {
		const allTracks = TrackManager.getAll();
		const trackAddresses = Object.keys(allTracks);
		if (trackAddresses.length === 0) { alert('Нет данных треков'); return; }

		const lines = [];
		for (const addr of trackAddresses) {
			const hexAddr = parseInt(addr).toString(16).toUpperCase(); // 0-F
			for (const point of allTracks[addr]) {
				if (point.isTimeout || point.lat == null || point.lon == null || isNaN(point.lat) || isNaN(point.lon)) continue;
				const ts = new Date(point.ts);
				const hh = String(ts.getUTCHours()).padStart(2, '0');
				const mm = String(ts.getUTCMinutes()).padStart(2, '0');
				const ss = String(ts.getUTCSeconds()).padStart(2, '0');
				const ss2 = String(ts.getUTCMilliseconds() / 10).padStart(2, '0'); // сотые доли
				const timeStr = `${hh}${mm}${ss}.${ss2}`;
				const lat = Math.abs(point.lat);
				const latDeg = Math.floor(lat);
				const latMin = (lat - latDeg) * 60;
				const latHemi = point.lat >= 0 ? 'N' : 'S';
				const lon = Math.abs(point.lon);
				const lonDeg = Math.floor(lon);
				const lonMin = (lon - lonDeg) * 60;
				const lonHemi = point.lon >= 0 ? 'E' : 'W';
				const depth = !isNaN(point.dpt) ? point.dpt : 0;
				const sentence = `B${hexAddr}GGA,${timeStr},${String(latDeg).padStart(2,'0')}${latMin.toFixed(4)},${latHemi},${String(lonDeg).padStart(3,'0')}${lonMin.toFixed(4)},${lonHemi},1,04,,${depth.toFixed(1)},M,,M,,`;
				const nmeaLine = '$' + sentence;
				let cs = 0;
				for (let i = 1; i < nmeaLine.length; i++) cs ^= nmeaLine.charCodeAt(i);
				lines.push(nmeaLine + '*' + cs.toString(16).toUpperCase().padStart(2, '0'));
			}
		}

		if (lines.length === 0) { alert('Нет точек с координатами'); return; }
		const blob = new Blob([lines.join('\r\n')], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `gga_tracks_${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.nmea`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	function exportPSIMSSB() {
		const allTracks = TrackManager.getAll();
		const trackAddresses = Object.keys(allTracks);
		if (trackAddresses.length === 0) { alert('Нет данных треков'); return; }

		const lines = [];
		for (const addr of trackAddresses) {
			for (const point of allTracks[addr]) {
				if (point.isTimeout) continue;
				if (point.xM == null || point.yM == null || isNaN(point.xM) || isNaN(point.yM)) continue;

				const ts = new Date(point.ts);
				// Только время: hhmmss (по спецификации PSIMSSB)
				const hh = String(ts.getUTCHours()).padStart(2, '0');
				const mm = String(ts.getUTCMinutes()).padStart(2, '0');
				const ss = String(ts.getUTCSeconds()).padStart(2, '0');
				const timeStr = `${hh}${mm}${ss}`;
				const btpId = 'B' + String(parseInt(addr) + 1).padStart(2, '0');
				const zM = (point.zM != null && !isNaN(point.zM)) ? point.zM : (!isNaN(point.dpt) ? point.dpt : 0);

				const sentence = `PSIMSSB,${timeStr},${btpId},A,,C,H,M,${point.xM.toFixed(2)},${point.yM.toFixed(2)},${zM.toFixed(2)},0.0,N,,`;
				const nmeaLine = '$' + sentence;
				let cs = 0;
				for (let i = 1; i < nmeaLine.length; i++) cs ^= nmeaLine.charCodeAt(i);
				lines.push(nmeaLine + '*' + cs.toString(16).toUpperCase().padStart(2, '0'));
			}
		}

		if (lines.length === 0) { alert('Нет точек с относительными координатами. Нужна топопривязка.'); return; }
		const blob = new Blob([lines.join('\r\n')], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `psimssb_tracks_${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.nmea`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

    // ========== ПУБЛИЧНЫЙ API ==========
	return {
		init,
		toggleConnection, disconnectSerial,
		toggleInterrogation,
		toggleTopoPanel, applyTopoBinding, clearTopoBinding,
		openSettings, closeSettings, applySettings,
		onMaskChanged, onAddrCheckboxChanged,
		toggleTracks, clearTracks, exportTracksKML,
		onBeaconCardClick,
		toggleGNSS,
		toggleCalibration, startCalibration, stopCalibration,
		cycleTheme,
		toggleDropdown, closeAllDropdowns,
		showLogAnalysis, closeAnalysis, copyAnalysis,
		saveLog, loadLog, togglePlayback,
		exportCSV, exportGGA, exportPSIMSSB,
		getPhoneGPS
	};

})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});