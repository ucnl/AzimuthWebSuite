// app.js — Главный модуль приложения Zima2 USBL Web PWA
// Связывает SerialBridge, AZMParser, AZMManager, TrackManager, Logger, Canvas

const App = (() => {

    const APP_VERSION = '1.2.5';


    // ========== DOM-ЭЛЕМЕНТЫ ==========
    let canvas, ctx;
    let mapContainer, beaconsBar, scaleBarEl;   
    let connectionIndicator, statusText, deviceLabel;
	let btnTracksShow, btnTracksClear;
	let btnConnection, btnInterrogation, btnSettings;
	let btnGnss;
    let playbackProgress, playbackProgressFill;
	let activeDropdown = null;
	let lastBeaconsHash = '';
    
    let lastMouseX = 0, lastMouseY = 0;    

    // ========== СОСТОЯНИЕ ПРИЛОЖЕНИЯ ==========
    let serialBridge = null;
    let isConnected = false;
    let ageTimer = null;

	let compassMode = 'auto';
	let hasTrueHeading = false;
	
	const PLAYBACK_SPEEDS = [1, 2, 4, 8];

	function getCurrentSpeedIndex() {
		const current = Logger.getCurrentPlaybackSpeed();
		return PLAYBACK_SPEEDS.indexOf(current);
	}

	function updateSpeedUI() {
		const spanSpeedCurrent = document.getElementById('playback-speed-current');
		if (spanSpeedCurrent) {
			const current = Logger.getCurrentPlaybackSpeed();
			spanSpeedCurrent.textContent = current + 'x';
		}
	}

	function increasePlaybackSpeed() {
		let idx = getCurrentSpeedIndex();
		if (idx === -1) idx = 0;
		let newIdx = (idx + 1) % PLAYBACK_SPEEDS.length;
		let newSpeed = PLAYBACK_SPEEDS[newIdx];
		Logger.setPlaybackSpeed(newSpeed);
		updateSpeedUI();
		setStatus(`Скорость воспроизведения: ${newSpeed}x`);
	}

	function decreasePlaybackSpeed() {
		let idx = getCurrentSpeedIndex();
		if (idx === -1) idx = 0;
		let newIdx = (idx - 1 + PLAYBACK_SPEEDS.length) % PLAYBACK_SPEEDS.length;
		let newSpeed = PLAYBACK_SPEEDS[newIdx];
		Logger.setPlaybackSpeed(newSpeed);
		updateSpeedUI();
		setStatus(`Скорость воспроизведения: ${newSpeed}x`);
	}	
	
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
		const themeName = Themes.cycleTheme();
		setStatus('Тема: ' + themeName);
	}
	
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function setStatus(msg) {
        if (statusText) statusText.textContent = msg;
        console.log('[App]', msg);
    }
	
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
	 function init() {
		document.getElementById('app-version').textContent = `${APP_VERSION}`;
		
		LogStorage.open().catch(e => console.warn('IndexedDB недоступна:', e));
		console.log('[App] Инициализация...');

		canvas = document.getElementById('map-canvas');
		ctx = canvas.getContext('2d');
		mapContainer = document.getElementById('map-container');
		beaconsBar = document.getElementById('beacons-bar');
		scaleBarEl = document.getElementById('scale-bar');				

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
		
		window.addEventListener('resize', () => UICanvas.resizeCanvas());
		initMouseHandlers();
		initTouchHandlers();
		loadSettings();  // ← оставить
		
		document.addEventListener('click', function(e) {
			if (!e.target.closest('.dropdown')) {
				closeAllDropdowns();
			}
		});
		
		const antennaInfo = document.getElementById('antenna-info');
		if (antennaInfo) {
			antennaInfo.addEventListener('click', function() {
				UICanvas.setAutoScaleEnabled(true);
				UICanvas.autoScale();
			});
		}
		
		const compassEl = document.getElementById('cfg-compass-mode');
		if (compassEl) compassEl.value = compassMode;
		
		if (!compassMode) compassMode = 'auto';
		
		Themes.init();
		
		// ИНИЦИАЛИЗАЦИЯ ОТРИСОВК
		UICanvas.init(canvas, mapContainer, {
			getAZMManager: () => AZMManager,
			getTrackManager: () => TrackManager,
			getUIRuler: () => UIRuler,
			getThemes: () => Themes,
			setStatus: (msg) => setStatus(msg),
			onBeaconsChanged: () => updateBeaconsBar(),
		});

		// ИНИЦИАЛИЗАЦИЯ ЛИНЕЙКИ
		UIRuler.init(canvas, ctx, {
			getOffsetX: () => UICanvas.getOffset().x,
			getOffsetY: () => UICanvas.getOffset().y,
			getScale: () => UICanvas.getScale(),
			drawCallback: () => UICanvas.drawAll(),
			setStatus: (msg) => setStatus(msg),			
		});
		
		// ИНИЦИАЛИЗАЦИЯ НАСТРОЕК	
		UISettings.init('settings-overlay', {
			getSettingsData: () => updateSettingsUI(),
			applySettingsData: () => applySettings(),
			loadSettingsData: () => loadSettings()
		});
		
		// Вызов построения чекбоксов маски (через модуль)
		UISettings.buildAddressCheckboxes();
		
		// ИНИЦИАЛИЗАЦИЯ ТОПОПРИВЯЗКИ
		UITopo.init('topo-panel', {
			setStatus: (msg) => setStatus(msg),
			getGnssConnected: () => isGnssConnected,
			setAntennaPosition: (lat, lon, hdg) => AZMManager.setAntennaPosition(lat, lon, hdg),
			recalcAllBeacons: () => AZMManager.recalcAllBeacons(),
			updateAntennaInfoUI: () => updateAntennaInfoUI(),
			updateAllButtons: () => updateAllButtons()
		});
		
		// Загружаем сохранённую привязку
		UITopo.loadTopoBinding();
		
		// ИНИЦИАЛИЗАЦИЯ КАЛИБРОВКИ
		UICalibration.init('calibration-panel', {
			getState: () => AZMManager.getState(),
			setAntennaOffsets: (x, y, phi) => AZMManager.setAntennaOffsets(x, y, phi),
			saveSettings: () => saveSettings(),
			setStatus: (msg) => setStatus(msg),
			isConnected: () => isConnected,
			getSerialBridge: () => serialBridge,
			getStartCommand: () => AZMManager.getStartCommand(),
			logOutgoing: (port, data) => Logger.logOutgoing(port, data),
			recalcAllBeacons: () => AZMManager.recalcAllBeacons()
		});
		
		// Загружаем сохранённую калибровку
		UICalibration.loadCalibrationFromStorage();
		
		updateAllButtons();
		updateSettingsUI();
		updateAntennaInfoUI();

		requestAnimationFrame(renderLoop);
		ageTimer = setInterval(tickAll, 1000);
		updateAllButtons();
		
		// Инициализация контролов скорости воспроизведения
		const btnSpeedDown = document.getElementById('btn-speed-down');
		const btnSpeedUp = document.getElementById('btn-speed-up');
		if (btnSpeedDown) btnSpeedDown.onclick = () => decreasePlaybackSpeed();
		if (btnSpeedUp) btnSpeedUp.onclick = () => increasePlaybackSpeed();

		console.log('[App] Инициализация завершена');
	}

    // ========== ТАЙМЕР СТАРЕНИЯ ==========
    function tickAll() { AZMManager.tickAge(); }

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

		const st = AZMManager.getState();
		let dist, azm;
		let isFilterAccepted = false;

		// Проверяем, прошла ли точка фильтр
		if (!isNaN(beacon.absoluteDistanceM) && !isNaN(beacon.absoluteAzimuthDeg) && beacon.absoluteDistanceM > 0) {
			dist = beacon.absoluteDistanceM;
			azm = beacon.absoluteAzimuthDeg;
			isFilterAccepted = true;
		} else if (!isNaN(beacon.slantRangeProjectionM) && !isNaN(beacon.azimuthDeg) && beacon.slantRangeProjectionM > 0) {
			dist = beacon.slantRangeProjectionM;
			azm = beacon.azimuthDeg + (st.antennaHeadingDeg || 0);
		} else if (!isNaN(beacon.slantRangeM) && !isNaN(beacon.azimuthDeg) && beacon.slantRangeM > 0) {
			dist = beacon.slantRangeM;
			azm = beacon.azimuthDeg + (st.antennaHeadingDeg || 0);
		} else {
			return;
		}

		// Только принятые точки идут в трек
		if (isFilterAccepted) {
			let xM = NaN, yM = NaN, zM = NaN;

			if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg) && !isNaN(st.antennaHeadingDeg) &&
				!isNaN(beacon.latitudeDeg) && !isNaN(beacon.longitudeDeg)) {
				
				const deltas = GeoUtils.deltasByDegrees(st.antennaLatDeg, st.antennaLonDeg, beacon.latitudeDeg, beacon.longitudeDeg);
				const headingRad = st.antennaHeadingDeg * Math.PI / 180;
				const cosH = Math.cos(headingRad);
				const sinH = Math.sin(headingRad);
				xM = deltas.deltaLatM * cosH + deltas.deltaLonM * sinH;
				yM = -deltas.deltaLatM * sinH + deltas.deltaLonM * cosH;
				zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;
			} else if (!isNaN(dist) && !isNaN(azm) && !isNaN(st.antennaHeadingDeg)) {
				const relativeAzmRad = (azm - st.antennaHeadingDeg) * Math.PI / 180;
				xM = dist * Math.cos(relativeAzmRad);
				yM = dist * Math.sin(relativeAzmRad);
				zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;
			}

			TrackManager.addPoint(
				beacon.address, dist, azm,
				beacon.latitudeDeg, beacon.longitudeDeg, beacon.depthM,
				beacon.isTimeout,
				xM, yM, zM
			);
		}

		// Калибровка — только для принятых
		if (UICalibration.isActive() && isFilterAccepted && !isNaN(beacon.absoluteDistanceM) && !isNaN(beacon.azimuthDeg)) {
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
			UICalibration.addPoint();
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
				UITopo.setGnssConnected(false);
				updateAllButtons();
				Logger.logInfo('GNSS disconnected');
			};

			const saved = localStorage.getItem('zima2_settings');
			const gnssBaud = saved ? (JSON.parse(saved).gnssBaudrate || 38400) : 38400;
			await gnssBridge.open(gnssBaud);

			isGnssConnected = true;
			UITopo.setGnssConnected(true);
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
		UITopo.setGnssConnected(false);
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
			
			if (UITopo.isOpen()) {
				UITopo.updateFieldsFromGNSS(data.latitude, data.longitude, data.heading);
				document.getElementById('topo-gnss-status').textContent = '✓ Внешний GNSS';
				document.getElementById('topo-gnss-status').className = 'locked';
			}
		} else if (data.type === 'hdt' && !isNaN(data.heading)) {
			hasTrueHeading = true;
			if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
				AZMManager.setAntennaPosition(st.antennaLatDeg, st.antennaLonDeg, data.heading);
				updateAntennaInfoUI();
				if (UITopo.isOpen()) {
					document.getElementById('topo-hdg').value = data.heading.toFixed(1);
				}
			}
		} else if (data.type === 'hdm' && !isNaN(data.heading)) {
			if (shouldUseHeading('hdm')) {
				if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
					AZMManager.setAntennaPosition(st.antennaLatDeg, st.antennaLonDeg, data.heading);
					updateAntennaInfoUI();
					if (UITopo.isOpen()) {
						document.getElementById('topo-hdg').value = data.heading.toFixed(1);
					}
				}
			}
		}
	}
	
	
	// ========== КАЛИБРОВКА ==========
	function toggleCalibration() { UICalibration.toggle(); }
	function startCalibration() { UICalibration.start(); }
	function stopCalibration() { UICalibration.stop(); }
	function loadCalibrationFile() { UICalibration.loadCalibrationFile(); }
	function resetCalibration() { UICalibration.resetCalibration(); }

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
	function toggleTopoPanel() { UITopo.toggle(); }
	function applyTopoBinding() { UITopo.applyBinding(); }
	function clearTopoBinding() { UITopo.clearBinding(); }

	function getPhoneGPS() { UITopo.getPhoneGPS(); }

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

		btnConnection.disabled = true;
		btnGnss.disabled = true;

		// Сбрасываем скорость перед стартом
		Logger.setPlaybackSpeed(1.0);
		updateSpeedUI();

		Logger.startPlayback(1.0, true, true);
		playbackProgress.style.display = 'block';
		if (serialBridge) serialBridge.onMessage = null;

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
		const speedControl = document.getElementById('playback-speed-control');
		if (speedControl) speedControl.style.display = 'inline-flex';
		updateSpeedUI();
    }

	function onPlaybackEnd() {
		AZMManager.setTimeProvider(() => new Date());
		playbackProgress.style.display = 'none';
		
		// Скрываем контрол скорости
		const speedControl = document.getElementById('playback-speed-control');
		if (speedControl) speedControl.style.display = 'none';
		
		// Сбрасываем скорость на 1x
		Logger.setPlaybackSpeed(1.0);
		updateSpeedUI();

		if (serialBridge && isConnected) {
			serialBridge.onMessage = onSerialMessage;
		}

		btnConnection.disabled = false;
		btnGnss.disabled = false;
		updateAllButtons();

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

    // ========== ОТРИСОВКА ==========
    function renderLoop() {
        UICanvas.drawAll();
        requestAnimationFrame(renderLoop);
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
			const range = !isNaN(b.slantRangeProjectionM) && b.slantRangeProjectionM > 0 
				? b.slantRangeProjectionM.toFixed(1) + ' м'
				: !isNaN(b.slantRangeM) && b.slantRangeM > 0 
					? b.slantRangeM.toFixed(1) + ' м'
					: !isNaN(b.absoluteDistanceM) 
						? b.absoluteDistanceM.toFixed(1) + ' м'
						: '--';
			const azm = !isNaN(b.absoluteAzimuthDeg) 
				? b.absoluteAzimuthDeg.toFixed(1) + '°'
				: !isNaN(b.rejectedAzimuthDeg)
					? '(' + b.rejectedAzimuthDeg.toFixed(1) + '°)'
					: !isNaN(b.azimuthDeg) 
						? '(' + b.azimuthDeg.toFixed(1) + '°)'
						: '--';

			html += `
			<div class="beacon-card ${cardClass}" onclick="App.onBeaconCardClick(${b.address})">
				<div class="bc-addr">#${userAddr}</div>
				<div class="bc-range">📏 ${range}  🌊 ${!isNaN(b.depthM) ? b.depthM.toFixed(1) + 'м' : '--'}</div>
				<div class="bc-azimuth">🧭 ${azm}</div>
				<div class="bc-msr">📶 ${!isNaN(b.msrDB) ? b.msrDB.toFixed(1) + ' dB' : '--'}</div>
				<div class="bc-vcc">🔋 ${!isNaN(b.vccV) ? b.vccV.toFixed(1) + ' V' : '--'}  🌡 ${!isNaN(b.waterTempC) ? b.waterTempC.toFixed(1) + ' °C' : '--'}</div>
				<div class="bc-coords">${!isNaN(b.latitudeDeg) ? b.latitudeDeg.toFixed(6) : '--'}, ${!isNaN(b.longitudeDeg) ? b.longitudeDeg.toFixed(6) : '--'}</div>
				<div class="bc-age ${ageClass}">⏱ ${age.toFixed(0)}с${b.isTimeout ? ' ⌛' : ''}</div>
			</div>`;
		});
        beaconsBar.innerHTML = html;
    }

	function onBeaconCardClick(address) {
		
		const b = AZMManager.getBeacons()[address];
		if (!b) return;

		UICanvas.setAutoScaleEnabled(true);
		UICanvas.autoScale();
	}

    // ========== МЫШЬ И ТАЧ ==========
	function initMouseHandlers() {
		canvas.addEventListener('wheel', (e) => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			UICanvas.zoom(e.deltaY, e.clientX, e.clientY, rect);
		});

		canvas.addEventListener('mousedown', (e) => {
			e.preventDefault();
			UICanvas.setDraggingEnabled(true);
			lastMouseX = e.clientX; lastMouseY = e.clientY;
			canvas.style.cursor = 'grabbing';
		});

		canvas.addEventListener('mousemove', (e) => {
			if (UICanvas.isDraggingEnabled()) {
				const dx = e.clientX - lastMouseX;
				const dy = e.clientY - lastMouseY;
				UICanvas.updateFromInteraction(dx, dy);
				lastMouseX = e.clientX; lastMouseY = e.clientY;
			}
			
			if (!UICanvas.isDraggingEnabled() && UIRuler.isActive() && UIRuler.getPointsCount() === 1) {
				UIRuler.handleMouseMove(e);
			}
		});

		canvas.addEventListener('mouseup', () => { 
			UICanvas.setDraggingEnabled(false); 
			canvas.style.cursor = 'grab'; 
		});
		
		canvas.addEventListener('mouseleave', () => { 
			UICanvas.setDraggingEnabled(false); 
			canvas.style.cursor = 'grab'; 
		});

		canvas.addEventListener('dblclick', () => {
			UICanvas.resetView();
		});
		
		canvas.addEventListener('click', (e) => {
			if (UIRuler.isActive()) {
				UIRuler.handleClick(e);
			}
		});
	}

	function initTouchHandlers() {
		let initDist = 0, initScale = 1;

		canvas.addEventListener('touchstart', (e) => {
			e.preventDefault();
			if (e.touches.length === 1) {
				UICanvas.setDraggingEnabled(true);
				lastMouseX = e.touches[0].clientX;
				lastMouseY = e.touches[0].clientY;
			} else if (e.touches.length === 2) {
				UICanvas.setDraggingEnabled(false);
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				initDist = Math.sqrt(dx * dx + dy * dy);
				initScale = UICanvas.getScale();
			}
		});

		canvas.addEventListener('touchmove', (e) => {
			e.preventDefault();
			if (e.touches.length === 1 && UICanvas.isDraggingEnabled()) {
				const dx = e.touches[0].clientX - lastMouseX;
				const dy = e.touches[0].clientY - lastMouseY;
				UICanvas.updateFromInteraction(dx, dy);
				lastMouseX = e.touches[0].clientX;
				lastMouseY = e.touches[0].clientY;
			} else if (e.touches.length === 2) {
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (initDist > 0) {
					const newScale = initScale * (dist / initDist);
					UICanvas.setScale(newScale);
					UICanvas.setAutoScaleEnabled(false);
				}
			}
		});

		canvas.addEventListener('touchend', () => { 
			UICanvas.setDraggingEnabled(false); 
		});
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
	function exportCSV() { ExportManager.exportCSV(); }
	function exportGGA() { ExportManager.exportGGA(); }
	function exportPSIMSSB() { ExportManager.exportPSIMSSB(); }
	function exportPSIMSSB_NE() { ExportManager.exportPSIMSSB_NE(); }
	function exportTracksKML() { ExportManager.exportTracksKML(); }

	// ========== ЛИНЕЙКА (обёртки для вызова из HTML) ==========
	function toggleRuler() { UIRuler.toggle(); }
	function drawRuler() { UIRuler.draw(); }	
	
	// ========== Настройки ==========
	function openSettings() { UISettings.open(); }
	function closeSettings() { UISettings.close(); }

	function applySettings() {
		// Получаем значения из UI
		const mask = UISettings.getInt('cfg-mask', 1);
		const maxDist = UISettings.getFloat('cfg-maxdist', 1000);
		const salinity = UISettings.getFloat('cfg-salinity', 0);
		
		const soundSpeedVal = UISettings.getValue('cfg-soundspeed', '');
		const soundSpeed = soundSpeedVal ? parseFloat(soundSpeedVal) : NaN;
		
		const offsX = UISettings.getFloat('cfg-offsetx', 0);
		const offsY = UISettings.getFloat('cfg-offsety', 0);
		const phi = UISettings.getFloat('cfg-phi', 0);
		const maxPoints = UISettings.getInt('cfg-maxpoints', 500);
		const minDist = UISettings.getFloat('cfg-minpointdist', 0.5);
		const maxBeaconSpeed = UISettings.getFloat('cfg-max-beacon-speed', 1.0);
		
		const newCompassMode = UISettings.getValue('cfg-compass-mode');
		if (newCompassMode) {
			compassMode = newCompassMode;
			if (compassMode !== 'auto') hasTrueHeading = false;
		}
		
		// Применяем настройки к менеджерам
		AZMManager.setAddressMask(mask);
		AZMManager.setMaxDistance(maxDist);
		AZMManager.setSalinity(salinity);
		AZMManager.setSoundSpeedAuto(isNaN(soundSpeed));
		if (!isNaN(soundSpeed)) AZMManager.setSoundSpeed(soundSpeed);
		AZMManager.setAntennaOffsets(offsX, offsY, phi);
		
		if (!isNaN(maxBeaconSpeed) && maxBeaconSpeed >= 0.5 && maxBeaconSpeed <= 5) {
			AZMManager.setMaxBeaconSpeed(maxBeaconSpeed);
		}
		
		TrackManager.setMaxPoints(maxPoints);
		TrackManager.setMinDistance(minDist);
		
		// Сохраняем
		saveSettings();
		
		// Перезапускаем опрос если активен
		if (isConnected && AZMManager.getState().isInterrogationActive) {
			const cmd = AZMManager.getStartCommand();
			Logger.logOutgoing('AZM', cmd.trim());
			serialBridge.send(cmd);
		}
		
		setStatus('Настройки применены');
		UISettings.close();
	}

	function updateSettingsUI() {
		const st = AZMManager.getState();
		const trs = TrackManager.getSettings();
		
		UISettings.setValue('cfg-mask', st.addressMask);
		UISettings.setValue('cfg-maxdist', st.maxDistM);
		UISettings.setValue('cfg-salinity', st.salinityPSU);
		
		const sosInput = document.getElementById('cfg-soundspeed');
		if (sosInput) {
			sosInput.value = (!isNaN(st.soundSpeedMps) && !st.soundSpeedAuto) ? st.soundSpeedMps.toFixed(1) : '';
		}
		
		UISettings.setValue('cfg-offsetx', st.offsetXM);
		UISettings.setValue('cfg-offsety', st.offsetYM);
		UISettings.setValue('cfg-phi', st.phiDeg);
		UISettings.setValue('cfg-maxpoints', trs.maxPointsPerTrack);
		UISettings.setValue('cfg-minpointdist', trs.minPointDistanceM);
		
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
		
		const maxSpeedEl = document.getElementById('cfg-max-beacon-speed');
		if (maxSpeedEl) maxSpeedEl.value = st.maxBeaconSpeedMps || 1.0;
		
		UISettings.syncCheckboxesFromMask(st.addressMask);
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
			maxBeaconSpeed: AZMManager.getState().maxBeaconSpeedMps || 1.0,
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
					if (el) el.value = data.compassMode; 
				}
				if (data.maxBeaconSpeed !== undefined) AZMManager.setMaxBeaconSpeed(data.maxBeaconSpeed);
			}
		} catch (e) {}
	}

	function onMaskChanged() {
		const mask = UISettings.getInt('cfg-mask', 0);
		UISettings.syncCheckboxesFromMask(mask);
	}

	function onAddrCheckboxChanged() {
		const mask = UISettings.getMaskFromCheckboxes();
		UISettings.updateMaskInput(mask);
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
		increasePlaybackSpeed,
		decreasePlaybackSpeed,
		exportCSV, exportGGA, exportPSIMSSB, exportPSIMSSB_NE,
		getPhoneGPS,
		loadCalibrationFile,
		resetCalibration,
		toggleRuler,
		resetView: () => UICanvas.resetView(),
		autoScale: () => UICanvas.autoScale(),
	};

})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});