// app.js — Главный модуль приложения Zima2 USBL Web PWA
// Связывает SerialBridge, AZMParser, AZMManager, TrackManager, Logger, Canvas

const App = (() => {

    const APP_VERSION = '1.3.6';


    // ========== DOM-ЭЛЕМЕНТЫ ==========
    let canvas, ctx;
    let mapContainer, beaconsBar, scaleBarEl;   
    let connectionIndicator, statusText, deviceLabel;
	let btnTracksShow, btnTracksClear;
	let btnConnection, btnInterrogation, btnSettings;
	let btnGnss;
    let playbackProgress, playbackProgressFill;
	let activeDropdown = null;	
	let remoteConfigPanel;
    
    let lastMouseX = 0, lastMouseY = 0;    

    // ========== СОСТОЯНИЕ ПРИЛОЖЕНИЯ ==========ы
    let serialBridge = null;
    let isConnected = false;
    let ageTimer = null;

	let compassMode = 'auto';
	let hasTrueHeading = false;
	
	const PLAYBACK_SPEEDS = [1, 2, 4, 8];
	
	let isRemoteDevice = false;
	let remoteCurrentAddr = null;
	const RemoteAddr = AZMParser.RemoteAddr;

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
		
		// Заголовок
		const title = document.getElementById('analysis-title');
		if (title) title.textContent = '🔍 Анализ лога';
		
		// Кнопка скачивания DRMS не нужна
		const downloadBtn = document.getElementById('analysis-download-btn');
		if (downloadBtn) downloadBtn.style.display = 'none';
		
		analysisPanel.style.display = 'block';
	}

	function closeAnalysis() {
		analysisPanel.style.display = 'none';
		// Очищаем глобальные данные DRMS при закрытии
		window._drmsCSV = null;
	}

	function copyAnalysis() {
		const text = analysisContent.innerText;
		navigator.clipboard.writeText(text).then(() => {
			setStatus('Отчёт скопирован');
		}).catch(() => {
			alert('Не удалось скопировать');
		});
	}
	
	function openDRMSWithPhi() {
		// Сначала считаем DRMS
		const allTracks = TrackManager.getAll();
		const trackAddresses = Object.keys(allTracks);
		
		if (trackAddresses.length === 0) {
			alert('Нет треков для расчёта. Сначала накопите треки маяков.');
			return;
		}
		
		// Вызываем обычный exportDRMS
		exportDRMS();
		
		// Меняем заголовок
		const title = document.getElementById('analysis-title');
		if (title) title.textContent = '🔧 Калибровка φ (по известной точке)';
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
		
		remoteConfigPanel = document.getElementById('remote-config-panel');

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
		loadSettings(); 
		
		document.addEventListener('click', function(e) {
			if (!e.target.closest('.dropdown')) {
				closeAllDropdowns();
			}
		});
		
		const antennaInfo = document.getElementById('antenna-info');
		if (antennaInfo) {
			antennaInfo.addEventListener('click', function() {
				const st = AZMManager.getState();
				if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
					UICanvas.followGeoPoint(st.antennaLatDeg, st.antennaLonDeg, 'antenna');
				} else {
					UICanvas.centerOnWorldPoint(0, 0);
				}
				setStatus('Слежение за антенной');
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
		
		// ИНИЦИАЛИЗАЦИЯ КАЛИБРОВКИ ТАБЛИЦЫ АНТЕННЫ
		UIAntennaCalibration.init({
			setStatus: (msg) => setStatus(msg)
		});
		
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
		
		// Загружаем POI
		POIManager.load();
		
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
			recalcAllBeacons: () => AZMManager.recalcAllBeacons(),
			parseCalibrationFile: (text) => AntennaCorrector.parseFromText(text),
			loadAntennaCalibration: (angles, errors) => AZMManager.loadAntennaCalibration(angles, errors),
			resetAntennaCalibration: () => AZMManager.resetAntennaCalibration()
		});
		
		// Загружаем сохранённую калибровку
		UICalibration.loadCalibrationFromStorage();
		
		
		// Инициализация мастера
		UIWizard.init({
			onComplete: function(state) {
				// Применяем режим
				const mode = state.moving ? 'geographic' : (state.hasTopo ? 'geographic' : 'cartesian_fixed');
				AZMManager.setAntennaMode(mode);
				
				if (mode === 'cartesian_fixed') {
					AZMManager.setAntennaPosition(NaN, NaN, 0);
				}
				
				// Сохраняем скорость GNSS
				if (state.gnssBaud) {
					try {
						const saved = localStorage.getItem('zima2_settings');
						const data = saved ? JSON.parse(saved) : {};
						data.gnssBaudrate = state.gnssBaud;
						localStorage.setItem('zima2_settings', JSON.stringify(data));
					} catch (e) {}
				}
				
				// Если нужно ввести топопривязку — открываем панель
				if (!state.moving && state.hasTopo) {
					setTimeout(() => UITopo.toggle(), 300);
				}
				
				updateSettingsUI();
				updateAntennaInfoUI();
				saveSettings();
			}
		});
		
		
		
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
			case 'rsts':
				handleRSTS(result.data);
				break;
			case 'ack':
				handleACK(result.data);
				break;
        }
    }

	function handleDINFO(info) {
		const typeNames = { 0: 'USBL', 1: 'Маяк-ответчик', 2: 'LBL' };
		let label = `Zima2 ${typeNames[info.deviceType] || ''}`.trim();
		if (info.serialNumber) label += ` [${info.serialNumber}]`;
		
		// Для маяка запоминаем адрес и добавляем кнопку настройки
		if (info.deviceType === 1) {
			isRemoteDevice = true;
			remoteCurrentAddr = info.remoteAddress; // 0-based
			const userAddr = remoteCurrentAddr !== RemoteAddr.REM_ADDR_INVALID ? remoteCurrentAddr + 1 : '?';
			deviceLabel.innerHTML = `${label} (адрес ${userAddr}) <span onclick="App.toggleRemoteConfig()" style="cursor:pointer; margin-left:4px; font-size:14px;" title="Настроить адрес">⚙</span>`;
			setStatus('Маяк подключен');
			return; // не запускаем опрос для маяка
		}
		
		isRemoteDevice = false;
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

	function handleRSTS(data) {		
		
		const statusEl = document.getElementById('remote-config-status');
		if (!isNaN(data.remoteAddr)) {
			remoteCurrentAddr = data.remoteAddr;
			const el = document.getElementById('remote-current-addr');
			if (el) el.textContent = remoteCurrentAddr + 1; // 1-based для отображения
		}
		if (statusEl) {
			statusEl.textContent = `✓ Адрес изменён на ${data.remoteAddr + 1}`;
			const rootStyles = getComputedStyle(document.documentElement);
			const statusSuccess = rootStyles.getPropertyValue('--status-success').trim() || '#4caf50';
			statusEl.style.color = statusSuccess;
		}
		setStatus(`Маяк: адрес изменён на ${data.remoteAddr + 1}`);
	}

	function handleACK(data) {
		const statusEl = document.getElementById('remote-config-status');
		if (statusEl) {
			
			const rootStyles = getComputedStyle(document.documentElement);
			
			if (data.result === 0) {
				statusEl.textContent = '✓ Команда принята';
				statusEl.style.color = rootStyles.getPropertyValue('--status-success').trim() || '#4caf50';
			} else {
				statusEl.textContent = `✗ Ошибка: код ${data.result}`;
				statusEl.style.color = rootStyles.getPropertyValue('--status-error').trim() || '#dc3545';
			}
		}
	}

	function handleBeaconUpdate(beacon) {
		if (!beacon) return;

		const st = AZMManager.getState();
		let dist, azm;
		let isFilterAccepted = false;

		if (st.antennaMode === 'cartesian_fixed') {
			// === ДЕКАРТОВ РЕЖИМ ===
			if (!isNaN(beacon.xM) && !isNaN(beacon.yM)) {
				dist = beacon.absoluteDistanceM;
				azm = beacon.absoluteAzimuthDeg;
				isFilterAccepted = true;
			} else if (!isNaN(beacon.rejectedXM)) {
				dist = beacon.rejectedDistanceM;
				azm = beacon.rejectedAzimuthDeg;
			} else if (!isNaN(beacon.slantRangeProjectionM) && !isNaN(beacon.azimuthDeg) && beacon.slantRangeProjectionM > 0) {
				dist = beacon.slantRangeProjectionM;
				azm = beacon.azimuthDeg;
			} else if (!isNaN(beacon.slantRangeM) && !isNaN(beacon.azimuthDeg) && beacon.slantRangeM > 0) {
				dist = beacon.slantRangeM;
				azm = beacon.azimuthDeg;
			} else {
				return;
			}

			if (isFilterAccepted) {
				TrackManager.addPoint(
					beacon.address, dist, azm,
					NaN, NaN, beacon.zM,
					beacon.isTimeout,
					beacon.xM, beacon.yM, beacon.zM
				);
			}

		} else {
			// === ГЕОГРАФИЧЕСКИЙ РЕЖИМ (существующая логика) ===
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
		}

		// Калибровка φ — только для географического режима
		if (st.antennaMode === 'geographic') {
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

			if (UIAntennaCalibration.isActive() && isFilterAccepted &&
				!isNaN(beacon.latitudeDeg) && !isNaN(beacon.longitudeDeg) &&
				!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg) && !isNaN(st.antennaHeadingDeg)) {

				const deltas = GeoUtils.deltasByDegrees(
					st.antennaLatDeg, st.antennaLonDeg,
					beacon.latitudeDeg, beacon.longitudeDeg
				);

				let absAzimuth = Math.atan2(deltas.deltaLonM, deltas.deltaLatM) * 180 / Math.PI;
				if (absAzimuth < 0) absAzimuth += 360;

				let relativeAzimuth = absAzimuth - st.antennaHeadingDeg;
				relativeAzimuth = ((relativeAzimuth % 360) + 360) % 360;

				const dist = GeoUtils.haversineDistance(
					st.antennaLatDeg, st.antennaLonDeg,
					beacon.latitudeDeg, beacon.longitudeDeg
				);

				AntennaTableCalibration.addPoint(
					st.antennaHeadingDeg,
					relativeAzimuth,
					dist,
					st.antennaLatDeg,
					st.antennaLonDeg,
					st.antennaDepthM || 0,
					beacon.depthM || 0
				);
				UIAntennaCalibration.addPoint();
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
        isRemoteDevice = false;
		remoteCurrentAddr = null;
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
		
		if (AZMManager.getState().antennaMode === 'cartesian_fixed') {
			return;
		}

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

		if (st.antennaMode === 'cartesian_fixed') {
			document.getElementById('ai-lat').textContent = 'Y=0.00';  // Широта = North = Y
			document.getElementById('ai-lon').textContent = 'X=0.00';  // Долгота = East = X
			document.getElementById('ai-hdg').textContent = '0.0';
			document.getElementById('ai-dpt').textContent = isNaN(st.antennaDepthM) ? '--' : st.antennaDepthM.toFixed(1);
		} else {
			document.getElementById('ai-lat').textContent = isNaN(st.antennaLatDeg) ? '--' : st.antennaLatDeg.toFixed(6);
			document.getElementById('ai-lon').textContent = isNaN(st.antennaLonDeg) ? '--' : st.antennaLonDeg.toFixed(6);
			document.getElementById('ai-hdg').textContent = isNaN(st.antennaHeadingDeg) ? '--' : st.antennaHeadingDeg.toFixed(1);
			document.getElementById('ai-dpt').textContent = isNaN(st.antennaDepthM) ? '--' : st.antennaDepthM.toFixed(1);
		}

		document.getElementById('ai-spd').textContent = isNaN(st.speedMps) ? '--' : st.speedMps.toFixed(2);
		document.getElementById('ai-crs').textContent = isNaN(st.courseDeg) ? '--' : st.courseDeg.toFixed(1);
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
			btnGnss.className = 'top-btn btn-disconnect';
		} else {
			btnGnss.textContent = '📡 GNSS';
			btnGnss.className = 'top-btn btn-gnss';
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


    // ========== НАСТРОЙКИ МАЯКА ==========
	
	function toggleRemoteConfig() {
		if (!remoteConfigPanel) return;
		if (remoteConfigPanel.style.display === 'none' || !remoteConfigPanel.style.display) {
			const el = document.getElementById('remote-current-addr');
			if (el) {
				const userAddr = remoteCurrentAddr !== null && remoteCurrentAddr !== AZMParser.RemoteAddr.REM_ADDR_INVALID 
					? remoteCurrentAddr + 1 
					: '--';
				el.textContent = userAddr;
			}
			const statusEl = document.getElementById('remote-config-status');
			if (statusEl) { statusEl.textContent = ''; }
			remoteConfigPanel.style.display = 'block';
		} else {
			remoteConfigPanel.style.display = 'none';
		}
	}

	async function sendRemoteConfig() {
		if (!serialBridge || !isConnected) {
			alert('Нет подключения');
			return;
		}
		
		const userAddr = parseInt(document.getElementById('cfg-remote-addr').value);
		const salinity = parseFloat(document.getElementById('cfg-remote-salinity').value);
		
		if (isNaN(userAddr) || userAddr < 1 || userAddr > 16) {
			alert('Адрес должен быть от 1 до 16');
			return;
		}
		
		// Отправляем 0-based адрес
		const addr = userAddr - 1;
		const cmd = AZMParser.buildRSTS(addr, isNaN(salinity) ? null : salinity);
		
		const rootStyles = getComputedStyle(document.documentElement);
		
		try {
			const statusEl = document.getElementById('remote-config-status');
			if (statusEl) {
				statusEl.textContent = '⏳ Отправка...';
				statusEl.style.color = rootStyles.getPropertyValue('--status-warning').trim() || '#ffc107';
			}
			Logger.logOutgoing('AZM', cmd.trim());
			await serialBridge.send(cmd);
			setStatus(`Отправлена команда смены адреса на ${addr}`);
		} catch (e) {
			const statusEl = document.getElementById('remote-config-status');
			if (statusEl) {
				statusEl.textContent = '✗ Ошибка отправки';
				statusEl.style.color = rootStyles.getPropertyValue('--status-error').trim() || '#dc3545';
			}
			alert('Ошибка отправки: ' + e.message);
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
		
		const st = AZMManager.getState();
		UICanvas.setScale(100);
		if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
			UICanvas.followGeoPoint(st.antennaLatDeg, st.antennaLonDeg, 'antenna');
		} else {
			UICanvas.centerOnWorldPoint(0, 0);
		}
		UICanvas.clearFollowTarget();  // сбрасываем слежение, чтобы не мешало

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
			
			if (AZMManager.getState().antennaMode === 'cartesian_fixed') {
               return;
			}
			
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


    // ========== POI ===========
	function loadPOI() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv,.txt';
		input.onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const count = POIManager.loadFromCSV(ev.target.result);
				if (count > 0) {
					setStatus(`Загружено ${count} POI`);
				} else {
					alert('Не удалось загрузить POI. Проверьте формат файла.');
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}

	function clearPOI() {
		if (POIManager.getCount() === 0) {
			alert('Нет POI для очистки');
			return;
		}
		if (confirm(`Очистить все POI (${POIManager.getCount()} шт.)?`)) {
			POIManager.clear();
			setStatus('POI очищены');
		}
	}

	function markBeaconPoint(address) {
		const beacon = AZMManager.getBeacons()[address];
		if (!beacon) return;
		
		// Берём последние валидные координаты (даже если текущая точка отвергнута)
		const lat = beacon.latitudeDeg;
		const lon = beacon.longitudeDeg;
		const depth = beacon.depthM;
		
		if (isNaN(lat) || isNaN(lon)) {
			alert('У маяка ещё нет координат');
			return;
		}
		
		const now = new Date();
		const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
		const name = `Маяк #${beacon.userAddress || address + 1} — ${timeStr}`;
		
		POIManager.addMarkedPoint(name, lat, lon, !isNaN(depth) ? depth : null);
		setStatus(`Отмечено: ${name}`);
	}

	function exportPOI_CSV() {
		const points = POIManager.getAll();
		if (points.length === 0) {
			alert('Нет POI для экспорта');
			return;
		}
		
		const lines = ['# POI Export', '# Name,Latitude,Longitude,Depth,Type,Timestamp'];
		lines.push('Name,Latitude,Longitude,Depth,Type,Timestamp');
		
		for (const poi of points) {
			lines.push([
				poi.name,
				poi.lat.toFixed(8),
				poi.lon.toFixed(8),
				poi.depth != null ? poi.depth.toFixed(1) : '',
				poi.type,
				new Date(poi.timestamp).toISOString()
			].join(','));
		}
		
		const text = lines.join('\n');
		const blob = new Blob([text], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `poi_export_${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		
		setStatus(`Экспортировано ${points.length} POI`);
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
			<div class="beacon-card ${cardClass}">
				<div class="bc-addr" onclick="App.onBeaconCardClick(${b.address})">#${userAddr}</div>
				<div class="bc-range" onclick="App.onBeaconCardClick(${b.address})">📏 ${range}  🌊 ${!isNaN(b.depthM) ? b.depthM.toFixed(1) + 'м' : '--'}</div>
				<div class="bc-azimuth" onclick="App.onBeaconCardClick(${b.address})">🧭 ${azm}</div>
				<div class="bc-msr" onclick="App.onBeaconCardClick(${b.address})">📶 ${!isNaN(b.msrDB) ? b.msrDB.toFixed(1) + ' dB' : '--'}</div>
				<div class="bc-vcc" onclick="App.onBeaconCardClick(${b.address})">🔋 ${!isNaN(b.vccV) ? b.vccV.toFixed(1) + ' V' : '--'}  🌡 ${!isNaN(b.waterTempC) ? b.waterTempC.toFixed(1) + ' °C' : '--'}</div>
				<div class="bc-coords" onclick="App.onBeaconCardClick(${b.address})">
					${!isNaN(b.latitudeDeg) ? b.latitudeDeg.toFixed(6) : '--'}, ${!isNaN(b.longitudeDeg) ? b.longitudeDeg.toFixed(6) : '--'}
				</div>
				<div class="bc-actions">${!isNaN(b.latitudeDeg) && !isNaN(b.longitudeDeg) ? 
						`<span class="bc-mark" onclick="event.stopPropagation(); App.markBeaconPoint(${b.address})" title="Отметить точку">📌</span>` 
						: ''}
				</div>
				<div class="bc-age ${ageClass}" onclick="App.onBeaconCardClick(${b.address})">⏱ ${age.toFixed(0)}с${b.isTimeout ? ' ⌛' : ''}</div>
			</div>`;
		});
        beaconsBar.innerHTML = html;
    }

	function onBeaconCardClick(address) {
		const b = AZMManager.getBeacons()[address];
		if (!b) return;
		
		const st = AZMManager.getState();
		
		if (st.antennaMode === 'cartesian_fixed') {
			if (!isNaN(b.xM) && !isNaN(b.yM)) {
				UICanvas.followCartesianPoint(b.xM, b.yM);
				setStatus(`Слежение за маяком #${b.userAddress || b.address + 1}`);
			} else {
				setStatus(`Маяк #${b.userAddress || b.address + 1} не имеет координат`);
			}
		} else {
			if (!isNaN(b.latitudeDeg) && !isNaN(b.longitudeDeg)) {
				UICanvas.followGeoPoint(b.latitudeDeg, b.longitudeDeg, 'beacon', address);
				setStatus(`Слежение за маяком #${b.userAddress || b.address + 1}`);
			} else {
				setStatus(`Маяк #${b.userAddress || b.address + 1} не имеет координат`);
			}
		}
	}

	function exportDRMS() {
		const allTracks = TrackManager.getAll();
		const trackAddresses = Object.keys(allTracks);
		const st = AZMManager.getState();
		const isCartesian = st.antennaMode === 'cartesian_fixed';
		
		if (trackAddresses.length === 0) {
			alert('Нет треков для расчёта');
			return;
		}
		
		let report = '';
		const csvLines = isCartesian
			? ['Beacon,Points,DRMS_m,2DRMS_m,3DRMS_m,SigmaX_m,SigmaY_m,CentroidX_m,CentroidY_m']
			: ['Beacon,Points,DRMS_m,2DRMS_m,3DRMS_m,SigmaX_m,SigmaY_m,CentroidLat,CentroidLon'];
		let beaconsWithStats = 0;
		
		// Сохраняем данные для калибровки φ
		window._drmsData = {};
		
		for (const addr of trackAddresses) {
			const track = allTracks[addr];
			let validPoints, cX = 0, cY = 0, stats;
			
			if (isCartesian) {
				validPoints = track.filter(p => !p.isTimeout && !isNaN(p.xM) && !isNaN(p.yM));
				if (validPoints.length < 3) continue;
				
				for (const p of validPoints) { cX += p.xM; cY += p.yM; }
				cX /= validPoints.length;
				cY /= validPoints.length;
				
				stats = GeoUtils.calcDRMS(validPoints.map(p => ({ x: p.xM, y: p.yM })));
			} else {
				validPoints = track.filter(p => !p.isTimeout && !isNaN(p.lat) && !isNaN(p.lon));
				if (validPoints.length < 3) continue;
				
				let cLat = 0, cLon = 0;
				for (const p of validPoints) { cLat += p.lat; cLon += p.lon; }
				cLat /= validPoints.length;
				cLon /= validPoints.length;
				
				stats = GeoUtils.calcDRMS(validPoints.map(p => {
					const d = GeoUtils.deltasByDegrees(cLat, cLon, p.lat, p.lon);
					return { x: d.deltaLonM, y: d.deltaLatM };
				}));
				cX = cLon; cY = cLat;
			}
			
			if (!stats) continue;
			
			beaconsWithStats++;
			const userAddr = parseInt(addr) + 1;
			
			if (isCartesian) {
				report += `Маяк #${userAddr}: DRMS=${stats.drms.toFixed(2)}м, 2DRMS=${stats.drms2.toFixed(2)}м, 3DRMS=${stats.drms3.toFixed(2)}м, σX=${stats.sigmaX.toFixed(2)}м, σY=${stats.sigmaY.toFixed(2)}м, точек=${stats.count}\n  Центроид: X=${cX.toFixed(2)}м, Y=${cY.toFixed(2)}м\n\n`;
				window._drmsData[addr] = { centroidXM: cX, centroidYM: cY, cartesian: true };
			} else {
				report += `Маяк #${userAddr}: DRMS=${stats.drms.toFixed(2)}м, 2DRMS=${stats.drms2.toFixed(2)}м, 3DRMS=${stats.drms3.toFixed(2)}м, σX=${stats.sigmaX.toFixed(2)}м, σY=${stats.sigmaY.toFixed(2)}м, точек=${stats.count}\n  Центроид: ${cY.toFixed(8)}, ${cX.toFixed(8)}\n\n`;
				window._drmsData[addr] = { centroidLat: cY, centroidLon: cX, cartesian: false };
			}
		}
		
		if (!report) {
			alert('Недостаточно данных для расчёта DRMS');
			return;
		}
		
		if (analysisPanel && analysisContent) {
			const title = document.getElementById('analysis-title');
			if (title) title.textContent = '📊 Отчёт DRMS';
			
			analysisContent.innerHTML = '<pre style="font-size:12px; line-height:1.6;">' + report + '</pre>';
			
			const downloadBtn = document.getElementById('analysis-download-btn');
			if (downloadBtn) downloadBtn.style.display = '';
			
			// Показываем секцию калибровки φ (только в географическом режиме)
			const phiSection = document.getElementById('drms-phi-section');
			if (phiSection) {
				if (!isCartesian && beaconsWithStats > 0) {
					phiSection.style.display = 'block';
					setupDRMSPhiSection();
				} else {
					phiSection.style.display = 'none';
				}
			}
			
			analysisPanel.style.display = 'block';
		} else {
			alert(report);
		}
		
		window._drmsCSV = csvLines.join('\n');
		setStatus(`DRMS рассчитан для ${beaconsWithStats} маяков`);
	}

	// Новая функция: настройка секции калибровки φ
	function setupDRMSPhiSection() {
		const data = window._drmsData;
		if (!data) return;
		
		const addresses = Object.keys(data).filter(a => !data[a].cartesian);
		const beaconSelect = document.getElementById('drms-phi-beacon');
		const beaconSelectDiv = document.getElementById('drms-phi-beacon-select');
		
		// Если больше одного маяка — показываем выпадающий список
		if (addresses.length > 1 && beaconSelect && beaconSelectDiv) {
			beaconSelectDiv.style.display = 'block';
			beaconSelect.innerHTML = addresses.map(a => {
				const userAddr = parseInt(a) + 1;
				return `<option value="${a}">Маяк #${userAddr}</option>`;
			}).join('');
			beaconSelect.onchange = updateDRMSPhiCentroid;
		}
		
		updateDRMSPhiCentroid();
		
		// Сбрасываем поля
		document.getElementById('drms-phi-real-lat').value = '';
		document.getElementById('drms-phi-real-lon').value = '';
		document.getElementById('drms-phi-result').style.display = 'none';
		document.getElementById('drms-phi-apply-btn').style.display = 'none';
		
		// Кнопка «Вычислить φ»
		const calcBtn = document.getElementById('drms-phi-calc-btn');
		calcBtn.onclick = calculatePhiFromDRMS;
		
		// Кнопка «Применить»
		const applyBtn = document.getElementById('drms-phi-apply-btn');
		applyBtn.onclick = applyPhiFromDRMS;
	}

	function updateDRMSPhiCentroid() {
		const data = window._drmsData;
		if (!data) return;
		
		let addr = null;
		const beaconSelect = document.getElementById('drms-phi-beacon');
		if (beaconSelect && beaconSelect.options.length > 0) {
			addr = beaconSelect.value;
		} else {
			// Берём первый (единственный)
			const addresses = Object.keys(data).filter(a => !data[a].cartesian);
			addr = addresses[0];
		}
		
		if (addr && data[addr]) {
			const d = data[addr];
			document.getElementById('drms-phi-centroid').textContent = 
				`${d.centroidLat.toFixed(8)}, ${d.centroidLon.toFixed(8)}`;
			// Сохраняем текущий адрес
			document.getElementById('drms-phi-centroid').dataset.addr = addr;
		}
	}

	function calculatePhiFromDRMS() {
		const data = window._drmsData;
		if (!data) return;
		
		const addr = document.getElementById('drms-phi-centroid').dataset.addr;
		const d = data[addr];
		if (!d || d.cartesian) return;
		
		const realLat = parseFloat(document.getElementById('drms-phi-real-lat').value);
		const realLon = parseFloat(document.getElementById('drms-phi-real-lon').value);
		
		if (isNaN(realLat) || isNaN(realLon)) {
			alert('Введите реальные координаты маяка');
			return;
		}
		
		// Координаты антенны
		const st = AZMManager.getState();
		const antLat = st.antennaLatDeg;
		const antLon = st.antennaLonDeg;
		
		if (isNaN(antLat) || isNaN(antLon)) {
			alert('Нет координат антенны. Выполните топопривязку.');
			return;
		}
		
		const antLatRad = antLat * Math.PI / 180;
		const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * antLatRad) + 1.175 * Math.cos(4 * antLatRad);
		const mPerDegLon = 111412.84 * Math.cos(antLatRad) - 93.5 * Math.cos(3 * antLatRad);
		
		// Азимут от антенны к реальной точке
		const deltaNReal = (realLat - antLat) * mPerDegLat;
		const deltaEReal = (realLon - antLon) * mPerDegLon;
		const azmReal = Math.atan2(deltaEReal, deltaNReal) * 180 / Math.PI;
		
		// Азимут от антенны к центроиду
		const deltaNCentroid = (d.centroidLat - antLat) * mPerDegLat;
		const deltaECentroid = (d.centroidLon - antLon) * mPerDegLon;
		const azmCentroid = Math.atan2(deltaECentroid, deltaNCentroid) * 180 / Math.PI;
		
		// φ = разница азимутов
		let phi = azmReal - azmCentroid;
		phi = ((phi % 360) + 360) % 360;
		if (phi > 180) phi -= 360;
		
		document.getElementById('drms-phi-value').textContent = phi.toFixed(1);
		document.getElementById('drms-phi-result').style.display = 'block';
		document.getElementById('drms-phi-apply-btn').style.display = 'block';
		
		window._drmsCalculatedPhi = phi;
	}

	function applyPhiFromDRMS() {
		if (isNaN(window._drmsCalculatedPhi)) return;
		
		const phi = window._drmsCalculatedPhi;
		
		// Записываем в поле настроек
		const phiEl = document.getElementById('cfg-phi');
		if (phiEl) phiEl.value = phi.toFixed(1);
		
		// Применяем к менеджеру
		const st = AZMManager.getState();
		AZMManager.setAntennaOffsets(st.offsetXM, st.offsetYM, phi);
		
		// Сохраняем
		saveSettings();
		
		// Обновляем статус калибровки
		if (typeof UICalibration !== 'undefined') {
			// Обновляем UI калибровки если нужно
		}
		
		setStatus(`φ = ${phi.toFixed(1)}° применён`);
		
		// Пересчитываем маяки
		AZMManager.recalcAllBeacons();
	}

	function downloadDRMS() {
		if (!window._drmsCSV) {
			alert('Нет данных DRMS для скачивания');
			return;
		}
		const blob = new Blob([window._drmsCSV], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `drms_report_${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
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

		// В dblclick:
		canvas.addEventListener('dblclick', () => {
			UICanvas.setScale(100);
			const st = AZMManager.getState();
			if (st.antennaMode === 'cartesian_fixed') {
				UICanvas.centerOnWorldPoint(0, 0);
			} else if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
				UICanvas.followGeoPoint(st.antennaLatDeg, st.antennaLonDeg, 'antenna');
			} else {
				UICanvas.centerOnWorldPoint(0, 0);
			}
			setStatus('Вид сброшен');
		});
		
		canvas.addEventListener('click', (e) => {
			if (UIRuler.isActive()) {
				UIRuler.handleClick(e);
			} else {
				UICanvas.clearFollowTarget();
				setStatus('Слежение отключено');  // добавить
			}
		});
	}

	function initTouchHandlers() {
		let initDist = 0, initScale = 1;
		let lastTouchTime = 0;
		let tapTimeout = null;

		canvas.addEventListener('touchstart', (e) => {
			e.preventDefault();
			
			const now = Date.now();
			if (now - lastTouchTime < 300 && e.touches.length === 1) {
				// Двойной тап - сброс вида
				UICanvas.setScale(100);
				const st = AZMManager.getState();
				if (st.antennaMode === 'cartesian_fixed') {
					UICanvas.centerOnWorldPoint(0, 0);
				} else if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
					UICanvas.followGeoPoint(st.antennaLatDeg, st.antennaLonDeg, 'antenna');
				} else {
					UICanvas.centerOnWorldPoint(0, 0);
				}
				setStatus('Вид сброшен');
				lastTouchTime = 0;
				return;
			}
			lastTouchTime = now;
			
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

		canvas.addEventListener('touchend', (e) => {
			e.preventDefault();
			
			// Обработка клика по линейке
			if (UIRuler.isActive() && !UICanvas.isDraggingEnabled() && e.touches.length === 0) {
				const rect = canvas.getBoundingClientRect();
				const lastTouch = e.changedTouches[0];
				if (lastTouch) {
					const fakeEvent = {
						clientX: lastTouch.clientX,
						clientY: lastTouch.clientY,
						getBoundingClientRect: () => rect
					};
					UIRuler.handleClick(fakeEvent);
				}
				UICanvas.setDraggingEnabled(false);
				return;
			}
			
			if (UICanvas.isDraggingEnabled()) {
				UICanvas.setDraggingEnabled(false);
			} else if (e.touches.length === 0 && !UIRuler.isActive()) {
				// Одиночный тап без движения - отключаем слежение
				if (tapTimeout) clearTimeout(tapTimeout);
				tapTimeout = setTimeout(() => {
					UICanvas.clearFollowTarget();
					setStatus('Слежение отключено');
					tapTimeout = null;
				}, 100);
			}
			
			UICanvas.setDraggingEnabled(false);
		});
	}

    // ========== ЗАКРЫТИЕ СТРАНИЦЫ ==========
	window.addEventListener('beforeunload', async (e) => {
		console.log('[App] Закрытие страницы, освобождаю порт...');
		
		// Проверяем наличие данных
		const tracks = TrackManager.getAll();
		const trackCount = Object.keys(tracks).length;
		const hasStationTrack = TrackManager.stationTrack.length > 0;
		const hasLog = Logger.getEntryCount() > 0;
		
		const hasData = (trackCount > 0 || hasStationTrack || hasLog);
		
		// Если есть данные — показываем предупреждение
		if (hasData) {
			e.preventDefault();
			e.returnValue = 'Есть несохранённые данные (треки, лог). Вы уверены, что хотите закрыть страницу?';
			return e.returnValue;
		}
		
		// Если данных нет — просто закрываем порты
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
	function exportAntennaGGA() { ExportManager.exportAntennaGGA(); }
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
		
		// === РЕЖИМ АНТЕННЫ — ПРИМЕНЯЕМ ПЕРВЫМ ===
		const newAntennaMode = UISettings.getValue('cfg-antenna-mode');
		const oldAntennaMode = AZMManager.getState().antennaMode;
		
		if (newAntennaMode) {
			AZMManager.setAntennaMode(newAntennaMode);
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
		
		// === ВОССТАНАВЛИВАЕМ ТОПОПРИВЯЗКУ ПОСЛЕ СМЕНЫ РЕЖИМА ===
		if (newAntennaMode === 'geographic' && newAntennaMode !== oldAntennaMode) {
			const saved = localStorage.getItem('topo_binding');
			if (saved) {
				try {
					const data = JSON.parse(saved);
					if (data.lat !== undefined && data.lon !== undefined && data.hdg !== undefined &&
						!isNaN(data.lat) && !isNaN(data.lon) && !isNaN(data.hdg)) {
						AZMManager.setAntennaPosition(data.lat, data.lon, data.hdg);
					} else {
						AZMManager.setAntennaPosition(NaN, NaN, NaN);
					}
				} catch (e) {
					AZMManager.setAntennaPosition(NaN, NaN, NaN);
				}
			} else {
				// Нет сохранённой привязки — сбрасываем всё
				AZMManager.setAntennaPosition(NaN, NaN, NaN);
			}
		} else if (newAntennaMode === 'cartesian_fixed' && newAntennaMode !== oldAntennaMode) {
			AZMManager.setAntennaPosition(NaN, NaN, 0);
		}
		
		// Сохраняем
		saveSettings();
		
		// Обновляем UI антенны
		updateAntennaInfoUI();
		
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
		
		const antennaModeEl = document.getElementById('cfg-antenna-mode');
		if (antennaModeEl) {
			antennaModeEl.value = st.antennaMode || 'geographic';
		}
		
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
			antennaMode: AZMManager.getState().antennaMode || 'geographic',
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
				
				if (data.antennaMode) {
					AZMManager.setAntennaMode(data.antennaMode);
				}

				if (data.antennaMode === 'cartesian_fixed') {
					AZMManager.setAntennaPosition(NaN, NaN, 0);
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
		isGNSSConnected: () => isGnssConnected,
		connectGNSS,
		toggleCalibration, startCalibration, stopCalibration,
		cycleTheme,
		toggleDropdown, closeAllDropdowns,
		showLogAnalysis, closeAnalysis, copyAnalysis,
		saveLog, loadLog, togglePlayback,
		increasePlaybackSpeed,
		decreasePlaybackSpeed,
		exportCSV, exportGGA, exportAntennaGGA, exportPSIMSSB, exportPSIMSSB_NE,
		exportDRMS, downloadDRMS,
		getPhoneGPS,
		loadCalibrationFile,
		resetCalibration,
		toggleRuler,
		resetView: () => UICanvas.resetView(),
		autoScale: () => UICanvas.autoScale(),
		toggleAntennaCalibration: () => { 
		    if (AZMManager.getState().antennaMode === 'cartesian_fixed') {
				alert('Калибровка таблицы антенны недоступна в режиме неподвижной антенны.\nТребуется топопривязка и географические координаты.');
				return;
			}
			UIAntennaCalibration.toggle();
		},
		startAntennaCalibration: () => UIAntennaCalibration.startCalibration(),
		stopAntennaCalibration: () => UIAntennaCalibration.stopCalibration(),
		buildAntennaTable: () => UIAntennaCalibration.buildTable(),
		applyAntennaTable: () => UIAntennaCalibration.applyTable(),
		downloadAntennaTable: () => UIAntennaCalibration.downloadTable(),
		loadPOI, clearPOI, markBeaconPoint,	exportPOI_CSV,
		toggleRemoteConfig,
		sendRemoteConfig,
		openDRMSWithPhi,
	};

})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});