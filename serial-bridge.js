// serial-bridge.js — Web Serial API wrapper with NMEA buffering
// Replaces NMEASerialPort
// Исправленная версия: корректное освобождение порта, обработка ошибок

class SerialBridge {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isOpen = false;
        this.readLoopAbortController = null;

        // NMEA line buffer (replaces NMEAPort.OnIncomingDataEx)
        this.lineBuffer = '';

        // Callbacks
        this.onMessage = null;    // (rawLine: string) => void
        this.onError = null;      // (error: Error) => void
        this.onClose = null;      // () => void
        this.onRawData = null;    // (data: Uint8Array) => void
    }

    /**
     * Request port from user and open it
     * @param {number} baudRate - defaults to 9600
     * @returns {Promise<boolean>}
     */
    async open(baudRate = 9600) {
        // Сначала гарантированно закрываем предыдущий порт если есть
        if (this.port || this.reader || this.writer) {
            console.log('[SerialBridge] Закрываю предыдущий порт перед открытием...');
            try {
                await this.close();
            } catch (e) {
                console.warn('[SerialBridge] Предупреждение при закрытии:', e.message);
            }
        }

        try {
            // Request port — must be triggered by user gesture
            console.log('[SerialBridge] Запрос порта у пользователя...');
            this.port = await navigator.serial.requestPort();

            console.log('[SerialBridge] Открытие порта...');
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            });

            console.log('[SerialBridge] Порт открыт успешно');

            this.isOpen = true;
            this.writer = this.port.writable.getWriter();
            this.reader = this.port.readable.getReader();
            this.lineBuffer = '';

            // Start async read loop
            this.readLoopAbortController = new AbortController();
            this._readLoop();

            return true;
        } catch (err) {
            this.isOpen = false;
            
            // Освобождаем ресурсы при ошибке
            await this._cleanupResources();
            
            console.error('[SerialBridge] Ошибка открытия порта:', err);
            
            if (this.onError) {
                this.onError(err);
            }
            throw err;
        }
    }

    /**
     * Send raw string to port (like NMEASerialPort.SendData)
     * @param {string} message
     */
    async send(message) {
        if (!this.writer) {
            throw new Error('Port not open');
        }

        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            await this.writer.write(data);
        } catch (err) {
            console.error('[SerialBridge] Ошибка отправки:', err);
            if (this.onError) {
                this.onError(err);
            }
            throw err;
        }
    }

    /**
     * Send raw bytes
     * @param {Uint8Array} data
     */
    async sendRaw(data) {
        if (!this.writer) {
            throw new Error('Port not open');
        }

        try {
            await this.writer.write(data);
        } catch (err) {
            console.error('[SerialBridge] Ошибка отправки raw:', err);
            if (this.onError) {
                this.onError(err);
            }
            throw err;
        }
    }

    /**
     * Internal read loop - accumulates bytes into NMEA lines
     */
    async _readLoop() {
        const decoder = new TextDecoder();
        let buffer = '';

        console.log('[SerialBridge] Цикл чтения запущен');

        try {
            while (this.reader && this.isOpen) {
                const { value, done } = await this.reader.read();
                
                if (done) {
                    console.log('[SerialBridge] Поток завершён (done=true)');
                    break;
                }

                // Raw data callback
                if (this.onRawData) {
                    try {
                        this.onRawData(value);
                    } catch (e) {
                        console.warn('[SerialBridge] Ошибка в onRawData:', e);
                    }
                }

                // Decode and accumulate
                buffer += decoder.decode(value, { stream: true });

                // Extract complete NMEA lines (ending with \n or \r\n)
                let newlineIdx;
                while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
                    let line = buffer.substring(0, newlineIdx);
                    buffer = buffer.substring(newlineIdx + 1);

                    // Убираем \r если есть
                    line = line.replace(/\r$/, '');

                    // Пропускаем пустые строки
                    if (line.length === 0) continue;

                    // Fire message event (like NewNMEAMessage)
                    if (this.onMessage) {
                        try {
                            this.onMessage(line);
                        } catch (e) {
                            console.warn('[SerialBridge] Ошибка в onMessage:', e);
                        }
                    }
                }

                // Safety: if buffer gets too large without newlines, reset
                if (buffer.length > 65535) {
                    console.warn('[SerialBridge] Буфер переполнен (>64KB без \\n), сброс');
                    buffer = '';
                }
            }
        } catch (err) {
            if (err.name === 'NetworkError') {
                // Порт был физически отключен
                console.log('[SerialBridge] Порт отключен (NetworkError)');
            } else if (err.name === 'AbortError') {
                // Read loop был отменён (close)
                console.log('[SerialBridge] Цикл чтения остановлен (AbortError)');
            } else {
                console.error('[SerialBridge] Ошибка в цикле чтения:', err);
                if (this.onError) {
                    this.onError(err);
                }
            }
        } finally {
            console.log('[SerialBridge] Цикл чтения завершён');
            this.isOpen = false;
            
            // Уведомляем о закрытии
            if (this.onClose) {
                try {
                    this.onClose();
                } catch (e) {
                    console.warn('[SerialBridge] Ошибка в onClose:', e);
                }
            }
        }
    }

    /**
     * Close the port and release all resources
     */
    async close() {
        console.log('[SerialBridge] Закрытие порта...');
        
        // 1. Отменяем read loop
        if (this.reader) {
            try {
                await this.reader.cancel();
                console.log('[SerialBridge] Reader отменён');
            } catch (e) {
                // AbortError — нормально
                if (e.name !== 'AbortError') {
                    console.warn('[SerialBridge] Ошибка отмены reader:', e.message);
                }
            }
        }

        // 2. Освобождаем reader
        if (this.reader) {
            try {
                this.reader.releaseLock();
                console.log('[SerialBridge] Reader освобождён');
            } catch (e) {
                console.warn('[SerialBridge] Ошибка освобождения reader:', e.message);
            }
            this.reader = null;
        }

        // 3. Освобождаем writer
        if (this.writer) {
            try {
                this.writer.releaseLock();
                console.log('[SerialBridge] Writer освобождён');
            } catch (e) {
                console.warn('[SerialBridge] Ошибка освобождения writer:', e.message);
            }
            this.writer = null;
        }

        // 4. Закрываем порт
        if (this.port) {
            try {
                await this.port.close();
                console.log('[SerialBridge] Порт закрыт');
            } catch (e) {
                console.warn('[SerialBridge] Ошибка закрытия порта:', e.message);
            }
            this.port = null;
        }

        // 5. Сбрасываем состояние
        this.isOpen = false;
        this.lineBuffer = '';
        this.readLoopAbortController = null;
        
        console.log('[SerialBridge] Все ресурсы освобождены');
    }

    /**
     * Принудительная очистка ресурсов (без ожидания)
     */
    async _cleanupResources() {
        if (this.reader) {
            try { this.reader.cancel(); } catch (e) {}
            try { this.reader.releaseLock(); } catch (e) {}
            this.reader = null;
        }
        if (this.writer) {
            try { this.writer.releaseLock(); } catch (e) {}
            this.writer = null;
        }
        if (this.port) {
            try { await this.port.close(); } catch (e) {}
            this.port = null;
        }
        this.isOpen = false;
        this.lineBuffer = '';
        this.readLoopAbortController = null;
    }

    /**
     * Проверить, открыт ли порт
     */
    get connected() {
        return this.isOpen && this.port !== null;
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SerialBridge;
}