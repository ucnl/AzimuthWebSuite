// serial-bridge.js — Web Serial API wrapper with NMEA buffering
// v5 — Fixed buffer overflow, backpressure, and robust error handling

class SerialBridge {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isOpen = false;
        this.lineBuffer = '';
        this.readInProgress = false; // защита от параллельных чтений

        // Callbacks
        this.onMessage = null;    // (rawLine: string) => void
        this.onError = null;      // (error: Error) => void
        this.onClose = null;      // () => void
    }

    /**
     * Request port from user and open it
     * @param {number} baudRate - defaults to 9600
     */
    async open(baudRate = 9600) {
        if (this.isOpen) {
            await this.close();
        }

        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
                bufferSize: 65536
            });
			
			await this._drainStaleData();

            this.isOpen = true;
            this.lineBuffer = '';
            this.readInProgress = false;
            this.writer = this.port.writable.getWriter();
            this.reader = this.port.readable.getReader();
            this._readLoop();
            return true;
        } catch (err) {
            console.error('[SerialBridge] Failed to open port:', err);
            if (this.onError) this.onError(err);
            throw err;
        }
    }
	
	/**
	 * Сбрасывает старые данные из буфера сразу после открытия порта
	 */
	async _drainStaleData() {
		const reader = this.port.readable.getReader();
		const decoder = new TextDecoder();
		let totalDiscarded = 0;

		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value && value.length > 0) {
					totalDiscarded += value.length;
					// Декодируем и просто выбрасываем
					decoder.decode(value);
				}
			}
		} catch (err) {
			// Игнорируем ошибки типа NetworkError — это нормально при сбросе
		} finally {
			try { reader.releaseLock(); } catch (e) {}
		}

		console.log(`[SerialBridge] Drained ${totalDiscarded} stale bytes`);
	}

    /**
     * Send raw string to port
     */
    async send(message) {
        if (!this.writer) throw new Error('Port not open');
        const data = new TextEncoder().encode(message);
        await this.writer.write(data);
    }

    /**
     * Internal read loop — try/catch inside while
     */
	 async _readLoop() {
		const decoder = new TextDecoder();
		console.log('[SerialBridge] Read loop started');

		while (this.reader && this.isOpen && !this.readInProgress) {
			try {
				this.readInProgress = true;
				const { value, done } = await this.reader.read();
				this.readInProgress = false;

				if (done) break;
				if (!value || value.length === 0) continue;

				const chunk = decoder.decode(value);
				this.lineBuffer += chunk;

				let idx;
				while ((idx = this.lineBuffer.indexOf('\n')) >= 0) {
					let line = this.lineBuffer.substring(0, idx);
					this.lineBuffer = this.lineBuffer.substring(idx + 1);
					line = line.replace(/\r$/, '').trim();

					if (line && line.startsWith('$') && this.onMessage) {
						try { this.onMessage(line); } catch (e) {
							console.warn('[SerialBridge] onMessage error:', e.message);
						}
					}
				}

				if (this.lineBuffer.length > 16384) {
					console.warn('[SerialBridge] Buffer overflow, reset');
					this.lineBuffer = '';
				}
			} catch (err) {
				this.readInProgress = false;
				if (err.name === 'NetworkError' || err.name === 'AbortError') {
					console.log('[SerialBridge] Port disconnected (' + err.name + ')');
					break;
				}
				if (err.name === 'TypeError' && err.message.includes('closed')) {
					break;
				}
				console.warn('[SerialBridge] Read error:', err.name);
				await new Promise(r => setTimeout(r, 100));
			}
		}

		console.log('[SerialBridge] Read loop ended');
		this.isOpen = false;
		if (this.onClose) {
			try { this.onClose(); } catch (e) {}
		}
	}

    /**
     * Close the port and release all resources
     */
    async close() {
        console.log('[SerialBridge] Closing...');
        try {
            // Сначала останавливаем чтение
            if (this.reader) {
                try { await this.reader.cancel(); } catch (e) {}
                try { this.reader.releaseLock(); } catch (e) {}
                this.reader = null;
            }
            // Потом освобождаем writer
            if (this.writer) {
                try { this.writer.releaseLock(); } catch (e) {}
                this.writer = null;
            }
            // И только потом закрываем порт
            if (this.port) {
                try { await this.port.close(); } catch (e) {}
                this.port = null;
            }
        } catch (e) {
            console.warn('[SerialBridge] Close error:', e.message);
        }
        this.isOpen = false;
        this.lineBuffer = '';
        this.readInProgress = false;
        console.log('[SerialBridge] Closed');
    }

    get connected() {
        return this.isOpen && this.port !== null;
    }
}
