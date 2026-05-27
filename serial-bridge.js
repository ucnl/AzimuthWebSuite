// serial-bridge.js — Web Serial API wrapper with NMEA buffering
// v4 — Clean version: big buffer, simple error handling

class SerialBridge {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isOpen = false;
        this.lineBuffer = '';

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
        if (this.port || this.reader || this.writer) {
            try { await this.close(); } catch (e) {}
        }

        this.port = await navigator.serial.requestPort();
        await this.port.open({
            baudRate: baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none',
            bufferSize: 65536
        });

        this.isOpen = true;
        this.lineBuffer = '';
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        this._readLoop();
        return true;
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

        while (this.reader && this.isOpen) {
            try {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (!value || value.length === 0) continue;

                this.lineBuffer += decoder.decode(value, { stream: true });

                let idx;
                while ((idx = this.lineBuffer.indexOf('\n')) >= 0) {
                    let line = this.lineBuffer.substring(0, idx);
                    this.lineBuffer = this.lineBuffer.substring(idx + 1);
                    line = line.replace(/\r$/, '').trim();
                    if (line && this.onMessage) {
                        try { this.onMessage(line); } catch (e) {}
                    }
                }

                if (this.lineBuffer.length > 131072) {
                    console.warn('[SerialBridge] Buffer overflow, reset');
                    this.lineBuffer = '';
                }
            } catch (err) {
                if (err.name === 'NetworkError' || err.name === 'AbortError') {
                    console.log('[SerialBridge] Port disconnected (' + err.name + ')');
                    break;
                }
                console.warn('[SerialBridge] Read error:', err.name);
                this.lineBuffer = '';
                await new Promise(r => setTimeout(r, 50));
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
            if (this.reader) {
                try { await this.reader.cancel(); } catch (e) {}
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
        } catch (e) {
            console.warn('[SerialBridge] Close error:', e.message);
        }
        this.isOpen = false;
        this.lineBuffer = '';
        console.log('[SerialBridge] Closed');
    }

    get connected() {
        return this.isOpen && this.port !== null;
    }
}