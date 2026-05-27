// logger.js — Запись и воспроизведение логов обмена с устройством
// v2: с IndexedDB хранилищем

const Logger = (() => {

    // ========== СОСТОЯНИЕ ==========
    let entries = [];            // кольцевой буфер в памяти
    let isRecording = false;
    let startTime = null;
    const MAX_MEMORY_ENTRIES = 10000;

    // Playback
    let playbackTimer = null;
    let playbackIndex = 0;
    let isPlaying = false;
    let playbackSpeed = 1.0;
    let playbackRealtime = true;
    let playbackStartReal = 0;
    let playbackStartLog = 0;

    // Callbacks
    let onEntry = null;
    let onPlaybackStart = null;
    let onPlaybackEnd = null;
    let onPlaybackProgress = null;

    // ========== ФОРМАТИРОВАНИЕ ==========

    function formatTimestamp(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    }

    function parseTimestamp(str) {
        const parts = str.split(':');
        if (parts.length !== 3) return NaN;
        const h = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        const secMs = parts[2].split('.');
        const s = parseInt(secMs[0]);
        const ms = secMs[1] ? parseInt(secMs[1].padEnd(3, '0')) : 0;
        return h * 3600 + m * 60 + s + ms / 1000;
    }

    // ========== ЗАПИСЬ ==========

    async function startRecording() {
        entries = [];
        startTime = new Date();
        isRecording = true;

        // Очищаем IndexedDB от старых логов
        try { await LogStorage.clear(); } catch (e) {}

        const day = String(startTime.getDate()).padStart(2, '0');
        const month = String(startTime.getMonth() + 1).padStart(2, '0');
        const year = startTime.getFullYear();
        const time = formatTimestamp(startTime);

        const header = `<Log started at ${day}-${month}-${year}, ${time}>`;
        entries.push({
            type: 'header',
            text: header,
            timestamp: 0,
            formatted: header,
        });
        LogStorage.write(header);
    }

    function stopRecording() {
        isRecording = false;
    }

    function _addToMemory(entry) {
        entries.push(entry);
        if (entries.length > MAX_MEMORY_ENTRIES) {
            entries.shift();
        }
    }

    function _addEntry(type, level, port, direction, data) {
        if (!startTime) startTime = new Date();
        const ts = Date.now() - startTime.getTime();
        const timeStr = formatTimestamp(new Date(startTime.getTime() + ts));
        let formatted;

        if (port) {
            formatted = `${timeStr}: ${level}: ${port} ${direction} ${data}`;
        } else {
            formatted = `${timeStr}: ${level}: ${data}`;
        }

        const entry = { type, level, port, direction, data, timestamp: ts, formatted };
        _addToMemory(entry);

        // Пишем в IndexedDB
        if (isRecording) {
            LogStorage.write(formatted);
        }
    }

    function logIncoming(port, data) {
        _addEntry('incoming', 'INFO', port, '>>', data);
    }

    function logOutgoing(port, data) {
        _addEntry('outgoing', 'INFO', port, '<<', data);
    }

    function logMessage(level, message) {
        _addEntry('message', level, null, null, message);
    }

    function logInfo(msg) { logMessage('INFO', msg); }
    function logError(msg) { logMessage('ERROR', msg); }
    function logWarning(msg) { logMessage('WARNING', msg); }

    // ========== ЭКСПОРТ (из IndexedDB) ==========

    async function exportLog() {
        try {
            const lines = await LogStorage.readAll();
            if (lines.length > 0) return lines.join('\n');
        } catch (e) {
            console.warn('[Logger] Ошибка чтения из IndexedDB:', e);
        }
        // Fallback: из памяти
        return entries.map(e => e.formatted || e.text || '').join('\n');
    }

    async function downloadLog(filename) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        filename = filename || `zima2_log_${ts}.log`;
        const text = await exportLog();
        if (!text || text.length < 50) {
            alert('Лог пуст или слишком короткий');
            return;
        }
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== ИМПОРТ ==========

	 function parseLogLine(line) {
		const idx = line.indexOf(': ');
		if (idx < 0) return null;

		const timeStr = line.substring(0, idx);
		const rest = line.substring(idx + 2);
		const ts = parseTimestamp(timeStr);
		if (isNaN(ts)) return null;

		const levelMatch = rest.match(/^(\w+):\s*(.*)$/);
		if (!levelMatch) return null;

		const level = levelMatch[1];
		const content = levelMatch[2];

		// Порт может содержать пробелы (например "COM4 (AZM)")
		const portMatch = content.match(/^(.+?)\s*(>>|<<)\s*(.+)$/);
		if (portMatch) {
			return {
				type: portMatch[2] === '>>' ? 'incoming' : 'outgoing',
				level,
				port: portMatch[1],
				direction: portMatch[2],
				data: portMatch[3],
				timestamp: ts,
				formatted: line,
			};
		}

		return {
			type: 'message',
			level,
			message: content,
			timestamp: ts,
			formatted: line,
		};
	}

    function importLog(text) {
        stopPlayback();
        entries = [];

        const lines = text.split('\n');
        let baseSeconds = 0;
        let prevSeconds = 0;
        let cumulativeTime = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('<Log started at')) {
                const dateMatch = trimmed.match(/<Log started at (\d{2})-(\d{2})-(\d{4}),/);
                if (dateMatch) {
                    const day = parseInt(dateMatch[1]);
                    const month = parseInt(dateMatch[2]) - 1;
                    const year = parseInt(dateMatch[3]);
                    baseSeconds = new Date(year, month, day).getTime() / 1000;
                }
                entries.push({
                    type: 'header', text: trimmed,
                    timestamp: 0, formatted: trimmed,
                });
                prevSeconds = 0;
                cumulativeTime = 0;
                continue;
            }

            const parsed = parseLogLine(trimmed);
            if (parsed) {
                if (entries.length <= 1) {
                    cumulativeTime = 0;
                    prevSeconds = parsed.timestamp;
                } else {
                    const diff = parsed.timestamp - prevSeconds;
                    if (diff >= 0) cumulativeTime += diff;
                    prevSeconds = parsed.timestamp;
                }
                parsed.timestamp = cumulativeTime * 1000;
                entries.push(parsed);
            }
        }

        return entries.length;
    }

    function loadLogFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.log,.txt';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) { reject('No file'); return; }
                const reader = new FileReader();
                reader.onload = () => {
                    const count = importLog(reader.result);
                    resolve(count);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            };
            input.click();
        });
    }

    // ========== ВОСПРОИЗВЕДЕНИЕ ==========

    function startPlayback(speed = 1.0, realtime = true) {
        if (entries.length === 0) return false;
        stopPlayback();

        playbackIndex = 0;
        playbackSpeed = speed;
        playbackRealtime = realtime;
        isPlaying = true;
        playbackStartReal = Date.now();
        playbackStartLog = entries.find(e => e.type !== 'header')?.timestamp || 0;

        if (onPlaybackStart) onPlaybackStart();
        if (onPlaybackProgress) onPlaybackProgress(0, entries.length);

        _playNext();
        return true;
    }

    function stopPlayback() {
        isPlaying = false;
        if (playbackTimer) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
        }
        playbackIndex = 0;
    }

	 function _playNext() {
		if (!isPlaying || playbackIndex >= entries.length) {
			isPlaying = false;
			if (onPlaybackEnd) onPlaybackEnd();
			return;
		}

		while (playbackIndex < entries.length && entries[playbackIndex].type === 'header') {
			playbackIndex++;
		}

		if (playbackIndex >= entries.length) {
			isPlaying = false;
			if (onPlaybackEnd) onPlaybackEnd();
			return;
		}

		const current = entries[playbackIndex];
		playbackIndex++;

		if (onPlaybackProgress) {
			onPlaybackProgress(playbackIndex, entries.length);
		}

		const elapsedReal = Date.now() - playbackStartReal;
		const virtualTime = new Date(playbackStartLog + current.timestamp + elapsedReal * playbackSpeed);

		if (onEntry && current.type !== 'header') {
			onEntry(current.data || current.message || '', current.timestamp, virtualTime, current);
		}

		if (playbackIndex < entries.length) {
			let next = entries[playbackIndex];
			while (next && next.type === 'header' && playbackIndex < entries.length) {
				playbackIndex++;
				next = entries[playbackIndex];
			}

			if (next) {
				if (playbackRealtime) {
					const logDelay = next.timestamp - current.timestamp;
					const realDelay = Math.max(1, logDelay / playbackSpeed);
					playbackTimer = setTimeout(_playNext, realDelay);
				} else {
					playbackTimer = setTimeout(_playNext, 1);
				}
			} else {
				isPlaying = false;
				if (onPlaybackEnd) onPlaybackEnd();
			}
		} else {
			isPlaying = false;
			if (onPlaybackEnd) onPlaybackEnd();
		}
	}

    function setPlaybackSpeed(speed) {
        playbackSpeed = Math.max(0.1, Math.min(100, speed));
    }

    // ========== СТАТИСТИКА ==========

    function getEntryCount() { return entries.length; }
    function getEntries() { return entries; }

    function getRecordingStatus() {
        return {
            isRecording, isPlaying,
            entryCount: entries.length,
            playbackIndex, playbackSpeed,
        };
    }

    // ========== ПУБЛИЧНЫЙ API ==========
	
	function debugEntries(n = 10) {
		const slice = entries.slice(0, n);
		console.log(`=== Logger entries (first ${n} of ${entries.length}) ===`);
		slice.forEach((e, i) => {
			console.log(`${i}: type="${e.type}" | ${e.formatted?.substring(0, 80) || '(no formatted)'}`);
		});
		const types = {};
		entries.forEach(e => { types[e.type] = (types[e.type] || 0) + 1; });
		console.log('Type counts:', types);
	}

	 return {
		startRecording, stopRecording,
		logIncoming, logOutgoing,
		logInfo, logError, logWarning,

		exportLog, downloadLog,
		importLog, loadLogFromFile,

		startPlayback, stopPlayback,
		setPlaybackSpeed,

		get onEntry() { return onEntry; },
		set onEntry(fn) { onEntry = fn; },
		get onPlaybackStart() { return onPlaybackStart; },
		set onPlaybackStart(fn) { onPlaybackStart = fn; },
		get onPlaybackEnd() { return onPlaybackEnd; },
		set onPlaybackEnd(fn) { onPlaybackEnd = fn; },
		get onPlaybackProgress() { return onPlaybackProgress; },
		set onPlaybackProgress(fn) { onPlaybackProgress = fn; },

		getEntryCount, getEntries, getRecordingStatus,
		debugEntries,
	};

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}