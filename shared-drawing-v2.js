// Single Large Canvas Drawing System
// One canvas for entire grid, coordinates normalized 0-1

class SharedDrawing {
    constructor() {
        this.roomId = null;
        this.drawMode = false;
        this.isDrawing = false;
        this.isInDrawingSession = false;
        this.currentStroke = [];
        
        // All strokes with normalized coordinates (0-1 scale)
        this.strokes = [];
        this.undoneStrokes = [];
        
        this.gridElement = null;
        this.canvas = null;
        this.ctx = null;
        
        this.strokesListener = null;
        this.syncTimer = null;
    }

    initialize(roomId, gridElement) {
        this.roomId = roomId;
        this.gridElement = gridElement;
        
        console.log('🎨 Single Canvas System initializing...');
        
        setTimeout(() => {
            this.createCanvas();
            this.setupFirebaseSync();
        }, 800);
    }

    createCanvas() {
        const gridRect = this.gridElement.getBoundingClientRect();
        
        console.log(`📏 Grid rect: ${gridRect.width}×${gridRect.height}`);
        
        if (gridRect.width === 0) {
            console.error('❌ Grid not ready, retrying...');
            setTimeout(() => this.createCanvas(), 500);
            return;
        }
        
        // Single large canvas
        const canvas = document.createElement('canvas');
        canvas.id = 'grid-drawing-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.touchAction = 'none';
        canvas.style.zIndex = '5';
        
        // Internal size with DPR
        const dpr = window.devicePixelRatio || 1;
        canvas.width = gridRect.width * dpr;
        canvas.height = gridRect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        this.canvas = canvas;
        this.ctx = ctx;
        
        this.gridElement.appendChild(canvas);
        
        console.log(`✅ Canvas created successfully!`);
        console.log(`   Internal: ${canvas.width}×${canvas.height}`);
        console.log(`   CSS: ${gridRect.width.toFixed(1)}×${gridRect.height.toFixed(1)}`);
        console.log(`   In DOM: ${document.getElementById('grid-drawing-canvas') ? 'YES' : 'NO'}`);
        
        this.setupEvents();
    }

    setupEvents() {
        // Mouse
        this.canvas.addEventListener('mousedown', (e) => this.pointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.pointerMove(e));
        this.canvas.addEventListener('mouseup', () => this.pointerUp());
        this.canvas.addEventListener('mouseleave', () => this.pointerUp());
        
        // Touch
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.pointerDown(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.pointerMove(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.pointerUp();
        }, { passive: false });
    }

    pointerDown(e) {
        if (!this.drawMode) return;
        
        this.isDrawing = true;
        this.isInDrawingSession = true;
        
        const pt = this.getPosition(e);
        this.currentStroke = [pt];
    }

    pointerMove(e) {
        if (!this.isDrawing) return;
        
        const pt = this.getPosition(e);
        this.currentStroke.push(pt);
        
        // Draw immediately
        if (this.currentStroke.length >= 2) {
            const prev = this.currentStroke[this.currentStroke.length - 2];
            this.drawSegment(prev, pt);
        }
    }

    pointerUp() {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        if (this.currentStroke.length < 2) {
            this.currentStroke = [];
            return;
        }
        
        this.strokes.push(this.currentStroke);
        this.undoneStrokes = [];
        
        console.log(`✅ Stroke: ${this.currentStroke.length} points`);
        
        if (this.syncTimer) clearTimeout(this.syncTimer);
        
        this.syncTimer = setTimeout(() => {
            this.isInDrawingSession = false;
            this.sync();
            this.syncTimer = null;
        }, 800);
        
        this.currentStroke = [];
    }

    getPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        
        // Use targetTouches
        const clientX = e.clientX || (e.targetTouches?.[0]?.clientX || 0);
        const clientY = e.clientY || (e.targetTouches?.[0]?.clientY || 0);
        
        const pixelX = clientX - rect.left;
        const pixelY = clientY - rect.top;
        
        // Round to integers
        const roundedX = Math.round(pixelX);
        const roundedY = Math.round(pixelY);
        
        // Normalize to 0-1
        const pt = {
            x: roundedX / rect.width,
            y: roundedY / rect.height,
            t: Date.now()
        };
        
        return pt;
    }

    drawSegment(p1, p2) {
        const rect = this.canvas.getBoundingClientRect();
        
        // Convert normalized to pixels
        const x1 = p1.x * rect.width;
        const y1 = p1.y * rect.height;
        const x2 = p2.x * rect.width;
        const y2 = p2.y * rect.height;
        
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 1.0;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
    }

    redraw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        for (const stroke of this.strokes) {
            for (let i = 1; i < stroke.length; i++) {
                this.drawSegment(stroke[i-1], stroke[i]);
            }
        }
    }

    toggleDrawMode() {
        if (!this.canvas) {
            console.error('❌ Canvas not ready yet!');
            return false;
        }
        
        this.drawMode = !this.drawMode;
        this.canvas.style.pointerEvents = this.drawMode ? 'auto' : 'none';
        console.log(`🖊️ Draw: ${this.drawMode ? 'ON' : 'OFF'}`);
        console.log(`   Canvas pointer-events: ${this.canvas.style.pointerEvents}`);
        return this.drawMode;
    }

    undo() {
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        
        if (this.strokes.length === 0) return;
        
        this.undoneStrokes.push(this.strokes.pop());
        this.redraw();
        this.sync();
    }

    redo() {
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        
        if (this.undoneStrokes.length === 0) return;
        
        this.strokes.push(this.undoneStrokes.pop());
        this.redraw();
        this.sync();
    }

    clearAll() {
        this.strokes = [];
        this.undoneStrokes = [];
        this.redraw();
        this.sync();
    }

    sync() {
        if (!this.roomId) return;
        
        const db = window.database || firebase.database();
        const ref = db.ref(`rooms/${this.roomId}/strokes`);
        
        if (this.strokes.length === 0) {
            ref.set(null);
        } else {
            ref.set(this.strokes);
        }
    }

    setupFirebaseSync() {
        const db = window.database || firebase.database();
        const ref = db.ref(`rooms/${this.roomId}/strokes`);
        
        this.strokesListener = ref.on('value', (snap) => {
            const data = snap.val();
            
            if (!data) {
                this.strokes = [];
                this.redraw();
                return;
            }
            
            if (this.isInDrawingSession) return;
            
            const curr = JSON.stringify(this.strokes);
            const next = JSON.stringify(data);
            
            if (next !== curr) {
                this.strokes = data;
                this.redraw();
                console.log(`📥 Received ${this.strokes.length} strokes`);
            }
        });
    }

    destroy() {
        if (this.strokesListener) {
            const db = window.database || firebase.database();
            db.ref(`rooms/${this.roomId}/strokes`).off('value', this.strokesListener);
        }
        if (this.canvas) this.canvas.remove();
    }
}

window.SharedDrawing = SharedDrawing;
