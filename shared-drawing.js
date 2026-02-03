// Per-Cell Canvas Drawing System
// Each cell gets its own canvas - eliminates position calculation issues!

class SharedDrawing {
    constructor() {
        this.roomId = null;
        this.drawMode = false;
        this.isDrawing = false;
        this.currentStroke = [];
        this.currentCell = null; // Current cell being drawn in
        
        // Store strokes per cell: { "row-col": [stroke1, stroke2, ...] }
        this.cellStrokes = {};
        
        // Undo/redo stacks store { cell: "row-col", stroke: [...] }
        this.undoneStrokes = [];
        
        this.gridElement = null;
        this.gridRows = 0;
        this.gridCols = 0;
        
        // Store cell canvases: { "row-col": {canvas, ctx, cell} }
        this.cellCanvases = {};
        
        this.strokesListener = null;
        
        // Flag to prevent redrawing our own changes
        this.isSyncingOwnChanges = false;
    }

    initialize(roomId) {
        this.roomId = roomId;
        this.gridElement = document.getElementById('crossword-grid');
        
        if (!this.gridElement) {
            console.error('❌ Grid element not found');
            return;
        }
        
        // Get grid dimensions from data attributes
        this.gridRows = parseInt(this.gridElement.dataset.rows) || 11;
        this.gridCols = parseInt(this.gridElement.dataset.cols) || 11;
        
        console.log('🎨 Per-Cell Drawing System initializing...');
        console.log(`Grid: ${this.gridRows}×${this.gridCols}`);
        
        // Wait longer for grid to be fully rendered with all cells
        setTimeout(() => {
            this.createCellCanvases();
            this.setupFirebaseSync();
        }, 800); // Increased from 200ms
    }

    createCellCanvases() {
        // Find all non-black cells and add a canvas to each
        const cells = this.gridElement.querySelectorAll('.grid-cell:not(.black-cell)');
        
        if (cells.length === 0) {
            console.error('❌ No cells found! Grid may not be rendered yet.');
            // Retry after delay
            setTimeout(() => this.createCellCanvases(), 500);
            return;
        }
        
        console.log(`📍 Found ${cells.length} cells to add canvases to`);
        
        let successCount = 0;
        
        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;
            
            try {
                // Create canvas element
                const canvas = document.createElement('canvas');
                canvas.className = 'cell-drawing-canvas';
                canvas.style.position = 'absolute';
                canvas.style.top = '0';
                canvas.style.left = '0';
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.pointerEvents = 'none'; // Disabled initially - won't block clicks
                canvas.style.zIndex = '5'; // Above cell content but below active highlights
                
                // Set canvas size to match cell (use device pixel ratio for sharp drawing)
                const rect = cell.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                canvas.style.width = rect.width + 'px';
                canvas.style.height = rect.height + 'px';
                
                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr); // Scale for device pixel ratio
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                
                // Store canvas and context
                this.cellCanvases[key] = { canvas, ctx, cell, dpr };
                
                // Add canvas to cell
                cell.style.position = 'relative';
                cell.appendChild(canvas);
                
                // Setup drawing events for this cell
                this.setupCellDrawing(canvas, key);
                
                successCount++;
            } catch (error) {
                console.error(`❌ Failed to create canvas for cell ${key}:`, error);
            }
        });
        
        console.log(`✅ Created ${successCount}/${cells.length} cell canvases successfully`);
        console.log('✅ Per-cell drawing system ready');
        console.log(`💡 Canvas pointer-events are 'none' by default - cells should be clickable!`);
    }

    setupCellDrawing(canvas, cellKey) {
        // Mouse events
        canvas.addEventListener('mousedown', (e) => this.handleCellPointerDown(e, cellKey));
        canvas.addEventListener('mousemove', (e) => this.handleCellPointerMove(e, cellKey));
        canvas.addEventListener('mouseup', () => this.handleCellPointerUp());
        canvas.addEventListener('mouseout', () => this.handleCellPointerUp());
        
        // Touch events
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleCellPointerDown(e, cellKey);
        }, { passive: false });
        
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handleCellPointerMove(e, cellKey);
        }, { passive: false });
        
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleCellPointerUp();
        }, { passive: false });
    }

    handleCellPointerDown(e, cellKey) {
        if (!this.drawMode) {
            console.log('⚠️ Not in draw mode - ignoring pointer down');
            return;
        }
        
        console.log(`🖊️ Drawing started in cell: ${cellKey}`);
        
        const point = this.getCellPointerPosition(e, cellKey);
        
        this.isDrawing = true;
        this.currentCell = cellKey;
        this.currentStroke = [point];
    }

    handleCellPointerMove(e, cellKey) {
        if (!this.isDrawing || !this.drawMode || cellKey !== this.currentCell) return;
        
        const point = this.getCellPointerPosition(e, cellKey);
        this.currentStroke.push(point);
        
        // Draw current stroke segment
        if (this.currentStroke.length >= 2) {
            const prev = this.currentStroke[this.currentStroke.length - 2];
            this.drawStrokeSegmentInCell(cellKey, prev, point);
        }
    }

    handleCellPointerUp() {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        if (this.currentStroke.length < 2) {
            this.currentStroke = [];
            this.currentCell = null;
            return;
        }
        
        // Save stroke to cell's stroke array
        if (!this.cellStrokes[this.currentCell]) {
            this.cellStrokes[this.currentCell] = [];
        }
        this.cellStrokes[this.currentCell].push(this.currentStroke);
        
        // Clear undo stack when new stroke is added
        this.undoneStrokes = [];
        
        console.log(`✅ Stroke saved to cell ${this.currentCell}`, this.currentStroke.length, 'points');
        
        // Small delay on mobile to ensure touch is fully released before syncing
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const syncDelay = isMobile ? 100 : 0;
        
        setTimeout(() => {
            // Sync to Firebase
            this.syncStrokesToFirebase();
        }, syncDelay);
        
        this.currentStroke = [];
        this.currentCell = null;
    }

    getCellPointerPosition(e, cellKey) {
        const { canvas, cell } = this.cellCanvases[cellKey];
        
        // Get the CELL rect (not canvas) for accurate positioning
        const cellRect = cell.getBoundingClientRect();
        const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
        const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
        
        // Calculate position relative to cell
        const pixelX = clientX - cellRect.left;
        const pixelY = clientY - cellRect.top;
        
        // Store as percentage (0-100) for device independence
        const percentage = {
            x: (pixelX / cellRect.width) * 100,  // Percentage
            y: (pixelY / cellRect.height) * 100, // Percentage
            t: Date.now()
        };
        
        console.log(`📍 Cell ${cellKey} - Touch: (${pixelX.toFixed(1)}, ${pixelY.toFixed(1)})px = (${percentage.x.toFixed(1)}, ${percentage.y.toFixed(1)})%`);
        
        return percentage;
    }

    drawStrokeSegmentInCell(cellKey, p1, p2) {
        const canvasData = this.cellCanvases[cellKey];
        if (!canvasData) return;
        
        const { ctx, cell } = canvasData;
        
        // Get CELL rect (CSS pixels) - ctx is already scaled by DPR
        const cellRect = cell.getBoundingClientRect();
        
        // Convert percentage to CSS pixels (ctx.scale handles DPR conversion)
        const x1 = (p1.x / 100) * cellRect.width;
        const y1 = (p1.y / 100) * cellRect.height;
        const x2 = (p2.x / 100) * cellRect.width;
        const y2 = (p2.y / 100) * cellRect.height;
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    redrawCell(cellKey) {
        const canvasData = this.cellCanvases[cellKey];
        if (!canvasData) return;
        
        const { canvas, ctx } = canvasData;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Redraw all strokes for this cell
        const strokes = this.cellStrokes[cellKey] || [];
        for (const stroke of strokes) {
            for (let i = 1; i < stroke.length; i++) {
                this.drawStrokeSegmentInCell(cellKey, stroke[i-1], stroke[i]);
            }
        }
    }

    redrawAllCells() {
        Object.keys(this.cellCanvases).forEach(cellKey => {
            this.redrawCell(cellKey);
        });
    }

    toggleDrawMode() {
        this.drawMode = !this.drawMode;
        
        // Enable/disable pointer events on all canvases
        Object.values(this.cellCanvases).forEach(({ canvas }) => {
            canvas.style.pointerEvents = this.drawMode ? 'auto' : 'none';
        });
        
        console.log(`🖊️ Draw mode: ${this.drawMode ? 'ON' : 'OFF'}`);
        return this.drawMode;
    }

    undo() {
        // Find last stroke across all cells (with timestamp)
        let lastCellKey = null;
        let lastStroke = null;
        let lastTimestamp = 0;
        
        for (const cellKey in this.cellStrokes) {
            const strokes = this.cellStrokes[cellKey];
            if (strokes && strokes.length > 0) {
                const stroke = strokes[strokes.length - 1];
                const timestamp = stroke[stroke.length - 1].t; // Last point's timestamp
                
                if (timestamp > lastTimestamp) {
                    lastTimestamp = timestamp;
                    lastCellKey = cellKey;
                    lastStroke = stroke;
                }
            }
        }
        
        if (!lastCellKey || !lastStroke) return;
        
        // Remove stroke from cell
        this.cellStrokes[lastCellKey].pop();
        if (this.cellStrokes[lastCellKey].length === 0) {
            delete this.cellStrokes[lastCellKey];
        }
        
        // Add to undo stack
        this.undoneStrokes.push({ cell: lastCellKey, stroke: lastStroke });
        
        // Redraw cell
        this.redrawCell(lastCellKey);
        this.syncStrokesToFirebase();
        
        console.log('↶ Undo - removed stroke from', lastCellKey);
    }

    redo() {
        if (this.undoneStrokes.length === 0) return;
        
        const { cell, stroke } = this.undoneStrokes.pop();
        
        // Add stroke back to cell
        if (!this.cellStrokes[cell]) {
            this.cellStrokes[cell] = [];
        }
        this.cellStrokes[cell].push(stroke);
        
        // Redraw cell
        this.redrawCell(cell);
        this.syncStrokesToFirebase();
        
        console.log('↷ Redo - restored stroke to', cell);
    }

    // Firebase sync
    setupFirebaseSync() {
        console.log('📡 Setting up Firebase sync for room:', this.roomId);
        
        const db = window.database || firebase.database();
        console.log('Database reference:', db ? '✅' : '❌');
        
        const strokesRef = db.ref(`rooms/${this.roomId}/cellStrokes`);
        
        this.strokesListener = strokesRef.on('value', (snapshot) => {
            console.log('🔄 Firebase update received');
            const data = snapshot.val();
            console.log('Cell strokes data:', data);
            
            if (!data) {
                this.cellStrokes = {};
                this.redrawAllCells();
                console.log('No strokes - cleared all canvases');
                return;
            }
            
            // Auto-convert old pixel-based strokes to percentages
            let needsConversion = false;
            const convertedData = {};
            
            for (const cellKey in data) {
                convertedData[cellKey] = [];
                for (const stroke of data[cellKey]) {
                    // Check if this is an old pixel-based stroke (values > 100)
                    const isPixelBased = stroke.some(point => point.x > 100 || point.y > 100);
                    
                    if (isPixelBased) {
                        console.log(`🔧 Converting old pixel stroke in cell ${cellKey} to percentages`);
                        needsConversion = true;
                        
                        // Assume old strokes were on a ~60-80px cell (average mobile/desktop)
                        // Convert to percentage (this is approximate but better than nothing)
                        const avgCellSize = 70;
                        const convertedStroke = stroke.map(point => ({
                            x: Math.min((point.x / avgCellSize) * 100, 100),
                            y: Math.min((point.y / avgCellSize) * 100, 100),
                            t: point.t
                        }));
                        convertedData[cellKey].push(convertedStroke);
                    } else {
                        // Already percentage-based
                        convertedData[cellKey].push(stroke);
                    }
                }
            }
            
            // If we converted any strokes, save back to Firebase
            if (needsConversion) {
                console.log('💾 Saving converted strokes back to Firebase');
                strokesRef.set(convertedData);
            }
            
            // Load all strokes from Firebase
            const currentStr = JSON.stringify(this.cellStrokes);
            const newStr = JSON.stringify(convertedData);
            
            if (newStr !== currentStr) {
                // Skip redraw if this is our own change (prevents flicker on iPhone)
                if (this.isSyncingOwnChanges) {
                    console.log('⏭️ Skipped - this is our own change (preventing flicker)');
                    return;
                }
                
                this.cellStrokes = convertedData;
                this.redrawAllCells();
                console.log('✅ All cells updated with synced strokes');
            } else {
                console.log('⏭️ Skipped - same strokes');
            }
        });
        
        console.log('✅ Firebase listener attached');
    }

    syncStrokesToFirebase() {
        if (!this.roomId) {
            console.warn('⚠️ No roomId - cannot sync strokes');
            return;
        }
        
        console.log('📤 Syncing all cell strokes to Firebase');
        
        // Set flag to prevent redrawing our own changes
        this.isSyncingOwnChanges = true;
        
        const db = window.database || firebase.database();
        const strokesRef = db.ref(`rooms/${this.roomId}/cellStrokes`);
        
        if (Object.keys(this.cellStrokes).length === 0) {
            strokesRef.set(null)
                .then(() => {
                    console.log('✅ Cleared all strokes from Firebase');
                    // Reset flag after a delay
                    setTimeout(() => { this.isSyncingOwnChanges = false; }, 500);
                })
                .catch(err => {
                    console.error('❌ Sync error:', err);
                    this.isSyncingOwnChanges = false;
                });
        } else {
            strokesRef.set(this.cellStrokes)
                .then(() => {
                    console.log('✅ All cell strokes synced');
                    // Reset flag after a delay to allow Firebase to propagate
                    setTimeout(() => { this.isSyncingOwnChanges = false; }, 500);
                })
                .catch(err => {
                    console.error('❌ Sync error:', err);
                    this.isSyncingOwnChanges = false;
                });
        }
    }

    cleanup() {
        if (this.strokesListener && this.roomId) {
            const db = window.database || firebase.database();
            const strokesRef = db.ref(`rooms/${this.roomId}/cellStrokes`);
            strokesRef.off('value', this.strokesListener);
        }
    }
}
