// modules/ui-canvas.js
// Отрисовка карты: сетка, маяки, антенна, треки, линейка

const UICanvas = (() => {
    let canvas, ctx;
    let mapContainer;
    
    // Состояние карты
    let scale = 100;
    let offsetX = 0, offsetY = 0;
    let isDragging = false;
    let autoScaleEnabled = true;
    
    // Колбэки для получения внешних данных
    let getAZMManager = null;
    let getTrackManager = null;
    let getUIRuler = null;
    let getThemes = null;
    let setStatus = null;
	
	let onBeaconsChanged = null;
	let lastBeaconsHash = '';
    
    function init(canvasEl, containerEl, callbacks) {
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        mapContainer = containerEl;
        
        getAZMManager = callbacks.getAZMManager;
        getTrackManager = callbacks.getTrackManager;
        getUIRuler = callbacks.getUIRuler;
        getThemes = callbacks.getThemes;
        setStatus = callbacks.setStatus;
		onBeaconsChanged = callbacks.onBeaconsChanged;
        
        resizeCanvas();
        window.addEventListener('resize', () => resizeCanvas());
    }
    
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
    
    function getScale() { return scale; }
    function setScale(newScale) { scale = Math.min(Math.max(newScale, 0.1), 5000); }
    function getOffset() { return { x: offsetX, y: offsetY }; }
    function setOffset(x, y) { offsetX = x; offsetY = y; }
    function isAutoScaleEnabled() { return autoScaleEnabled; }
    function setAutoScaleEnabled(enabled) { autoScaleEnabled = enabled; }
    function isDraggingEnabled() { return isDragging; }
    function setDraggingEnabled(enabled) { isDragging = enabled; }
    
    function getCanvasColors() {
        const Themes = getThemes ? getThemes() : null;
        if (Themes) return Themes.getCanvasColors();
        
        // Fallback
        const isLight = document.documentElement.classList.contains('theme-light');
        return {
            text: isLight ? '#1a1a1a' : '#ffffff',
            textSecondary: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)',
            stroke: isLight ? '#1a1a1a' : '#ffffff'
        };
    }
    
    function drawGrid() {
        const gridSize = 50;
        const rootStyles = getComputedStyle(document.documentElement);
        
        let gridColor = rootStyles.getPropertyValue('--map-grid').trim();
        let axisColor = rootStyles.getPropertyValue('--map-axis').trim();
        
        if (!gridColor) gridColor = 'rgba(255, 255, 255, 0.06)';
        if (!axisColor) axisColor = 'rgba(255, 255, 255, 0.2)';
        
        const AZMManager = getAZMManager ? getAZMManager() : null;
        const TrackManager = getTrackManager ? getTrackManager() : null;
        
        let cx = offsetX, cy = offsetY;
        if (AZMManager && TrackManager) {
            const st = AZMManager.getState();
            if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
                const anchor = TrackManager.getAnchor();
                if (!isNaN(anchor.lat)) {
                    const screen = GeoUtils.geoToScreen(
                        st.antennaLatDeg, st.antennaLonDeg,
                        anchor.lat, anchor.lon,
                        offsetX, offsetY, scale
                    );
                    cx = screen.x;
                    cy = screen.y;
                }
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
        const AZMManager = getAZMManager ? getAZMManager() : null;
        const TrackManager = getTrackManager ? getTrackManager() : null;
        const Themes = getThemes ? getThemes() : null;
        
        if (!AZMManager) return;
        
        const st = AZMManager.getState();
        const cc = getCanvasColors();
        
        let ax = offsetX, ay = offsetY;
        if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg) && TrackManager) {
            const anchor = TrackManager.getAnchor();
            if (!isNaN(anchor.lat)) {
                const screen = GeoUtils.geoToScreen(
                    st.antennaLatDeg, st.antennaLonDeg,
                    anchor.lat, anchor.lon,
                    offsetX, offsetY, scale
                );
                ax = screen.x;
                ay = screen.y;
            }
        }
        
        ctx.beginPath();
        ctx.moveTo(ax, ay - 18);
        ctx.lineTo(ax + 18, ay);
        ctx.lineTo(ax, ay + 18);
        ctx.lineTo(ax - 18, ay);
        ctx.closePath();
        
        const antennaFill = Themes ? Themes.getAntennaFill() : 'rgba(0, 255, 255, 0.5)';
        ctx.fillStyle = antennaFill;
        ctx.fill();
        ctx.strokeStyle = cc.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        
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
        const AZMManager = getAZMManager ? getAZMManager() : null;
        const TrackManager = getTrackManager ? getTrackManager() : null;
        
        if (!AZMManager) return;
        
        const beacons = AZMManager.getBeaconsArray();
        if (!beacons || beacons.length === 0) return;
        
        if (autoScaleEnabled && beacons.some(b => !isNaN(b.absoluteDistanceM) || !isNaN(b.slantRangeM))) {
            autoScale();
        }
        
        const cc = getCanvasColors();
        const anchor = TrackManager ? TrackManager.getAnchor() : { lat: NaN, lon: NaN };
        
        beacons.forEach(b => {
            let x, y, dist, azm;
            
            // Приоритет: абсолютные координаты через якорь → полярные от антенны
            if (!isNaN(b.latitudeDeg) && !isNaN(b.longitudeDeg) && !isNaN(anchor.lat)) {
                const screen = GeoUtils.geoToScreen(
                    b.latitudeDeg, b.longitudeDeg,
                    anchor.lat, anchor.lon,
                    offsetX, offsetY, scale
                );
                x = screen.x;
                y = screen.y;
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
    
    function drawRejectedPoints() {
        const AZMManager = getAZMManager ? getAZMManager() : null;
        const TrackManager = getTrackManager ? getTrackManager() : null;
        
        if (!AZMManager) return;
        
        const beacons = AZMManager.getBeaconsArray();
        if (!beacons || beacons.length === 0) return;
        
        const anchor = TrackManager ? TrackManager.getAnchor() : { lat: NaN, lon: NaN };
        
        beacons.forEach(b => {
            if (isNaN(b.rejectedDistanceM) || isNaN(b.rejectedAzimuthDeg)) return;
            if (b.rejectedDistanceM <= 0) return;
            
            let x, y;
            
            if (!isNaN(b.rejectedLatitudeDeg) && !isNaN(b.rejectedLongitudeDeg) && !isNaN(anchor.lat)) {
                const screen = GeoUtils.geoToScreen(
                    b.rejectedLatitudeDeg, b.rejectedLongitudeDeg,
                    anchor.lat, anchor.lon,
                    offsetX, offsetY, scale
                );
                x = screen.x;
                y = screen.y;
            } else {
                const ang = b.rejectedAzimuthDeg * Math.PI / 180;
                x = offsetX + b.rejectedDistanceM * Math.sin(ang) * scale;
                y = offsetY - b.rejectedDistanceM * Math.cos(ang) * scale;
            }
            
            if (isNaN(x) || isNaN(y)) return;
            
            const size = 8;
            ctx.strokeStyle = 'rgba(128, 128, 128, 0.45)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - size, y - size);
            ctx.lineTo(x + size, y + size);
            ctx.moveTo(x + size, y - size);
            ctx.lineTo(x - size, y + size);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(128, 128, 128, 0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            ctx.font = '9px Arial';
            ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
            ctx.textAlign = 'center';
            ctx.fillText(`${b.rejectedDistanceM.toFixed(0)}м`, x, y - 12);
        });
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
    
    function autoScale() {
        const AZMManager = getAZMManager ? getAZMManager() : null;
        const TrackManager = getTrackManager ? getTrackManager() : null;
        
        if (!AZMManager || !TrackManager) return;
        
        const beacons = AZMManager.getBeaconsArray();
        const anchor = TrackManager.getAnchor();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let found = false;
        
        const st = AZMManager.getState();
        
        // Трек станции (антенна)
        if (!isNaN(st.antennaLatDeg) && !isNaN(anchor.lat)) {
            const screen = GeoUtils.geoToScreen(
                st.antennaLatDeg, st.antennaLonDeg,
                anchor.lat, anchor.lon,
                0, 0, 1  // смещение 0, масштаб 1 для получения метров
            );
            minX = Math.min(minX, screen.x); maxX = Math.max(maxX, screen.x);
            minY = Math.min(minY, screen.y); maxY = Math.max(maxY, screen.y);
            found = true;
        }
        
        // Маяки
        beacons.forEach(b => {
            let wx, wy;
            
            if (!isNaN(b.latitudeDeg) && !isNaN(b.longitudeDeg) && !isNaN(anchor.lat)) {
                const screen = GeoUtils.geoToScreen(
                    b.latitudeDeg, b.longitudeDeg,
                    anchor.lat, anchor.lon,
                    0, 0, 1
                );
                wx = screen.x;
                wy = screen.y;
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
    
    function drawAll() {
        if (!ctx || canvas.width === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const TrackManager = getTrackManager ? getTrackManager() : null;
        const UIRuler = getUIRuler ? getUIRuler() : null;
        
        drawGrid();
        if (TrackManager) {
            TrackManager.drawStationTrack(ctx, offsetX, offsetY, scale);
            TrackManager.drawTracks(ctx, offsetX, offsetY, scale);
        }
        drawRejectedPoints();
        drawBeacons();
        drawAntenna();
        drawScaleBar();
        if (UIRuler) UIRuler.draw();
		
		const AZMManager = getAZMManager ? getAZMManager() : null;
		if (AZMManager && onBeaconsChanged) {
			const beacons = AZMManager.getBeaconsArray();
			const hash = beacons.map(b => `${b.address}:${b.dataAge}:${b.isTimeout}:${b.absoluteDistanceM?.toFixed(0)}:${b.absoluteAzimuthDeg?.toFixed(0)}`).join('|');
			
			if (hash !== lastBeaconsHash) {
				lastBeaconsHash = hash;
				onBeaconsChanged(beacons);
			}
		}
    }
    
    function updateFromInteraction(dx, dy) {
        offsetX += dx;
        offsetY += dy;
        autoScaleEnabled = false;
    }
    
    function zoom(wheelDelta, mouseX, mouseY, rect) {
        const mx = mouseX - rect.left;
        const my = mouseY - rect.top;
        
        const worldX = (mx - offsetX) / scale;
        const worldY = (offsetY - my) / scale;
        
        scale *= wheelDelta > 0 ? 0.85 : 1.18;
        scale = Math.min(Math.max(scale, 0.1), 5000);
        
        offsetX = mx - worldX * scale;
        offsetY = my + worldY * scale;
        
        autoScaleEnabled = false;
    }
    
    function resetView() {
        scale = 100;
        offsetX = canvas.width / 2;
        offsetY = canvas.height / 2;
        autoScaleEnabled = true;
    }
    
    return {
        init,
        drawAll,
        drawGrid,
        drawAntenna,
        drawBeacons,
        drawRejectedPoints,
        drawScaleBar,
        autoScale,
        getScale,
        setScale,
        getOffset,
        setOffset,
        isAutoScaleEnabled,
        setAutoScaleEnabled,
        isDraggingEnabled,
        setDraggingEnabled,
        updateFromInteraction,
        zoom,
        resetView,
        getCanvasColors,
        resizeCanvas
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UICanvas;
}