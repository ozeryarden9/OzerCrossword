// ========================
// Shared Drawing Canvas
// No recognition - just drawing
// ========================

class SharedDrawingCanvas {
    constructor(canvasId, gridElement) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.gridElement = gridElement;
        
        this.isDrawing = false;
        this.currentStroke = []; // Current stroke being drawn
        this.allStrokes = []; // All strokes (for undo/redo)
        this.undoneStrokes = []; // Strokes that were undone (for redo)
        
        this.gridRows = 11;
        this.gridCols = 11;
        this.cellWidth = 0;
        this.cellHeight = 0;
        this.gridOffset = { x: 0, y: 0 };
        
        this.roomId = null;
        this.drawMode = false; // false = type mode, true = draw mode
        
        this.strokesListener = null;
    }

    initialize(roomId) {
        this.roomId = roomId;
        this.setupCanvas();
        this.setupEventListeners();
        this.setupFirebaseSync();
    }

    setupCanvas() {
        // Set canvas size to match container
        const container = this.canvas.parentElement;
        this.canvas.width = container.offsetWidth;
        this.canvas.height = container.offsetHeight;
        
        // Calculate grid position - get actual grid element position relative to canvas
        const canvasRect = this.canvas.getBoundingClientRect();
        const gridRect = this.gridElement.getBoundingClientRect();
        
        this.gridOffset = {
            x: gridRect.left - canvasRect.left,
            y: gridRect.top - canvasRect.top
        };
        
        this.cellWidth = gridRect.width / this.gridCols;
        this.cellHeight = gridRect.height / this.gridRows;
        
        console.log('Drawing canvas setup:', {
            canvasSize: { w: this.canvas.width, h: this.canvas.height },
            gridOffset: this.gridOffset,
            cellSize: { width: this.cellWidth, height: this.cellHeight }
        });
    }

    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('mouseup', () => this.handlePointerUp());
        this.canvas.addEventListener('mouseout', () => this.handlePointerUp());
        
        // Touch events (iPad/iPhone)
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent default to avoid selection
            this.handlePointerDown(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handlePointerMove(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handlePointerUp();
        }, { passive: false });
    }

    handlePointerDown(e) {
        if (!this.drawMode) return; // Only draw in draw mode
        
        const point = this.getPointerPosition(e);
        
        // Check if point is within grid
        if (!this.isPointInGrid(point)) return;
        
        this.isDrawing = true;
        this.currentStroke = [point];
    }

    handlePointerMove(e) {
        if (!this.isDrawing || !this.drawMode) return;
        
        const point = this.getPointerPosition(e);
        
        // Check if point is within grid
        if (!this.isPointInGrid(point)) {
            // If moved outside grid, end stroke
            this.handlePointerUp();
            return;
        }
        
        this.currentStroke.push(point);
        
        // Draw current stroke segment
        if (this.currentStroke.length >= 2) {
            const prev = this.currentStroke[this.currentStroke.length - 2];
            this.drawStrokeSegment(prev, point);
        }
    }

    handlePointerUp() {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        if (this.currentStroke.length < 2) {
            this.currentStroke = [];
            return;
        }
        
        // Save stroke
        this.allStrokes.push(this.currentStroke);
        this.undoneStrokes = []; // Clear redo stack
        
        // Sync to Firebase
        this.syncStrokeToFirebase(this.currentStroke);
        
        this.currentStroke = [];
    }

    getPointerPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
        const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
        
        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
            t: Date.now()
        };
    }

    isPointInGrid(point) {
        const relX = point.x - this.gridOffset.x;
        const relY = point.y - this.gridOffset.y;
        
        return relX >= 0 && 
               relY >= 0 && 
               relX <= (this.gridCols * this.cellWidth) && 
               relY <= (this.gridRows * this.cellHeight);
    }

    drawStrokeSegment(p1, p2) {
        this.ctx.strokeStyle = '#000000'; // Black
        this.ctx.lineWidth = 1.5; // Thinner strokes
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
    }

    redrawAllStrokes() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        for (const stroke of this.allStrokes) {
            for (let i = 1; i < stroke.length; i++) {
                this.drawStrokeSegment(stroke[i-1], stroke[i]);
            }
        }
    }

    // Undo last stroke
    undo() {
        if (this.allStrokes.length === 0) return;
        
        const lastStroke = this.allStrokes.pop();
        this.undoneStrokes.push(lastStroke);
        
        this.redrawAllStrokes();
        this.syncAllStrokesToFirebase();
        
        console.log('↶ Undo');
    }

    // Redo last undone stroke
    redo() {
        if (this.undoneStrokes.length === 0) return;
        
        const stroke = this.undoneStrokes.pop();
        this.allStrokes.push(stroke);
        
        this.redrawAllStrokes();
        this.syncAllStrokesToFirebase();
        
        console.log('↷ Redo');
    }

    // Firebase sync
    setupFirebaseSync() {
        const strokesRef = window.firebase.database().ref(`rooms/${this.roomId}/sharedStrokes`);
        
        this.strokesListener = strokesRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                this.allStrokes = [];
                this.redrawAllStrokes();
                return;
            }
            
            // Load all strokes from Firebase
            const strokes = Object.values(data);
            
            // Only update if different to avoid infinite loop
            if (JSON.stringify(strokes) !== JSON.stringify(this.allStrokes)) {
                this.allStrokes = strokes;
                this.redrawAllStrokes();
            }
        });
    }

    syncStrokeToFirebase(stroke) {
        if (!this.roomId) return;
        
        const strokesRef = window.firebase.database().ref(`rooms/${this.roomId}/sharedStrokes`);
        strokesRef.push(stroke);
    }

    syncAllStrokesToFirebase() {
        if (!this.roomId) return;
        
        const strokesRef = window.firebase.database().ref(`rooms/${this.roomId}/sharedStrokes`);
        
        if (this.allStrokes.length === 0) {
            strokesRef.set(null);
        } else {
            strokesRef.set(this.allStrokes);
        }
    }

    toggleDrawMode() {
        this.drawMode = !this.drawMode;
        
        if (this.drawMode) {
            // Draw mode: enable drawing
            this.canvas.style.pointerEvents = 'auto';
            console.log('🖊️ Draw mode enabled');
        } else {
            // Type mode: disable drawing but keep canvas visible
            this.canvas.style.pointerEvents = 'none';
            console.log('⌨️ Type mode enabled');
        }
        
        // Canvas stays visible in both modes
        this.canvas.style.display = 'block';
        
        return this.drawMode;
    }

    enable() {
        this.drawMode = true;
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.display = 'block';
    }

    disable() {
        this.drawMode = false;
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.display = 'block'; // Keep visible!
    }

    cleanup() {
        if (this.strokesListener && this.roomId) {
            const strokesRef = window.firebase.database().ref(`rooms/${this.roomId}/sharedStrokes`);
            strokesRef.off('value', this.strokesListener);
        }
    }
}

// Make available globally
window.SharedDrawingCanvas = SharedDrawingCanvas;
