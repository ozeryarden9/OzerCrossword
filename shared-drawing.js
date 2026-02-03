// Per-Cell Canvas Drawing System
// Each cell gets its own canvas - eliminates position calculation issues!

class SharedDrawing {
    constructor() {
        this.roomId = null;
        this.drawMode = false;
        this.isDrawing = false; // Currently dragging/drawing a stroke
        this.isInDrawingSession = false; // In middle of drawing a letter (multiple strokes)
        this.currentStroke = [];
        this.currentCell = null; // Current cell being drawn in
        this.currentCellRect = null; // Cached rect during drawing to prevent shifts
        
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
        this.syncTimer = null; // Timer for delayed sync (allows multi-stroke letters)
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
                canvas.style.touchAction = 'none'; // Prevent scroll/zoom during drawing
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
        
        // Mark that we're in a drawing session
        this.isInDrawingSession = true;
        
        // Cache the CANVAS rect at START of stroke to prevent shifts during drawing
        const { canvas } = this.cellCanvases[cellKey];
        this.currentCellRect = canvas.getBoundingClientRect();
        
        console.log('Canvas rect cached:', {
            width: this.currentCellRect.width,
            height: this.currentCellRect.height,
            top: this.currentCellRect.top,
            left: this.currentCellRect.left
        });
        
        const point = this.getCellPointerPosition(e, cellKey);
        
        this.isDrawing = true;
        this.currentCell = cellKey;
        this.currentStroke = [point];
    }

    handleCellPointerMove(e, cellKey) {
        if (!this.isDrawing || !this.drawMode || cellKey !== this.currentCell) return;
        
        const point = this.getCellPointerPosition(e, cellKey);
        this.currentStroke.push(point);
        
        console.log(`✏️ Drawing point ${this.currentStroke.length}: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})%`);
        
        // Draw current stroke segment
        if (this.currentStroke.length >= 2) {
            const prev = this.currentStroke[this.currentStroke.length - 2];
            console.log(`🖌️ Drawing line from (${prev.x.toFixed(1)}, ${prev.y.toFixed(1)})% to (${point.x.toFixed(1)}, ${point.y.toFixed(1)})%`);
            this.drawStrokeSegmentInCell(cellKey, prev, point);
        }
    }

    handleCellPointerUp() {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        // Clear cached rect
        this.currentCellRect = null;
        
        if (this.currentStroke.length < 2) {
            console.log('⚠️ Stroke too short - discarded');
            this.currentStroke = [];
            this.currentCell = null;
            return;
        }
        
        console.log(`📝 Finishing stroke in cell ${this.currentCell} with ${this.currentStroke.length} points`);
        console.log('First point:', this.currentStroke[0]);
        console.log('Last point:', this.currentStroke[this.currentStroke.length - 1]);
        
        // Save stroke to cell's stroke array
        if (!this.cellStrokes[this.currentCell]) {
            this.cellStrokes[this.currentCell] = [];
        }
        this.cellStrokes[this.currentCell].push(this.currentStroke);
        
        // Clear undo stack when new stroke is added
        this.undoneStrokes = [];
        
        console.log(`✅ Stroke saved to cell ${this.currentCell}`, this.currentStroke.length, 'points');
        console.log('Total strokes in this cell:', this.cellStrokes[this.currentCell].length);
        console.log('All cell strokes:', Object.keys(this.cellStrokes));
        
        // Clear any existing sync timer
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
        }
        
        // Delay sync to allow multi-stroke letters (like א, ב, ש)
        // Only sync after user stops drawing for 800ms
        this.syncTimer = setTimeout(() => {
            console.log('⏰ Sync timer triggered - syncing now');
            
            // End drawing session
            this.isInDrawingSession = false;
            
            // Sync to Firebase - but DON'T redraw immediately
            // Let Firebase listener handle redraws from OTHER devices only
            this.syncStrokesToFirebase();
            this.syncTimer = null;
        }, 800);
        
        console.log('⏳ Sync delayed 800ms to allow multi-stroke letters');
        
        this.currentStroke = [];
        this.currentCell = null;
    }

    getCellPointerPosition(e, cellKey) {
        const { canvas } = this.cellCanvases[cellKey];
        
        // Use cached canvas rect during drawing, or get fresh one
        // IMPORTANT: Use CANVAS rect, not cell rect, for consistency
        const canvasRect = this.currentCellRect || canvas.getBoundingClientRect();
        const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
        const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
        
        // Calculate position relative to canvas
        const pixelX = clientX - canvasRect.left;
        const pixelY = clientY - canvasRect.top;
        
        // Store as percentage (0-100) for device independence
        const percentage = {
            x: (pixelX / canvasRect.width) * 100,  // Percentage
            y: (pixelY / canvasRect.height) * 100, // Percentage
            t: Date.now()
        };
        
        // Log if near bottom edge (y > 85%)
        if (percentage.y > 85) {
            console.log(`🔍 BOTTOM EDGE - Cell ${cellKey}: Touch at ${percentage.y.toFixed(1)}% (${pixelY.toFixed(1)}px of ${canvasRect.height.toFixed(1)}px)`);
        }
        
        return percentage;
    }

    drawStrokeSegmentInCell(cellKey, p1, p2) {
        const canvasData = this.cellCanvases[cellKey];
        if (!canvasData) {
            console.error(`❌ No canvas data for cell ${cellKey}`);
            return;
        }
        
        const { ctx, canvas } = canvasData;
        
        // Use CANVAS rect for drawing (matches saving coordinates)
        const canvasRect = canvas.getBoundingClientRect();
        
        // Convert percentage to CSS pixels (ctx.scale handles DPR conversion)
        const x1 = (p1.x / 100) * canvasRect.width;
        const y1 = (p1.y / 100) * canvasRect.height;
        const x2 = (p2.x / 100) * canvasRect.width;
        const y2 = (p2.y / 100) * canvasRect.height;
        
        // Always log on mobile to debug
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
            console.log(`🎨 Mobile drawing: (${x1.toFixed(0)}, ${y1.toFixed(0)}) → (${x2.toFixed(0)}, ${y2.toFixed(0)})`);
        }
        
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
        // Clear any pending sync timer
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        
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
        // Clear any pending sync timer
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        
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
            let conversionCount = 0;
            const convertedData = {};
            
            for (const cellKey in data) {
                convertedData[cellKey] = [];
                for (const stroke of data[cellKey]) {
                    // Check if this is an old pixel-based stroke (values > 100)
                    const isPixelBased = stroke.some(point => point.x > 100 || point.y > 100);
                    
                    if (isPixelBased) {
                        needsConversion = true;
                        conversionCount++;
                        
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
                console.log(`🔧 Converting ${conversionCount} old pixel-based strokes to percentages`);
                strokesRef.set(convertedData);
            }
            
            // Load all strokes from Firebase
            const currentStr = JSON.stringify(this.cellStrokes);
            const newStr = JSON.stringify(convertedData);
            
            if (newStr !== currentStr) {
                // Skip ALL redraws if in a drawing session
                if (this.isInDrawingSession) {
                    console.log('⏭️ Skipped - in drawing session');
                    this.cellStrokes = convertedData;
                    return;
                }
                
                // Find which cells have new strokes
                const cellsToRedraw = [];
                
                for (const cellKey in convertedData) {
                    const remoteStrokes = convertedData[cellKey] || [];
                    const localStrokes = this.cellStrokes[cellKey] || [];
                    
                    // Only redraw if remote has MORE strokes (from another device)
                    if (remoteStrokes.length > localStrokes.length) {
                        cellsToRedraw.push(cellKey);
                        console.log(`📥 Cell ${cellKey} has ${remoteStrokes.length - localStrokes.length} new stroke(s)`);
                    }
                }
                
                // Update local data
                this.cellStrokes = convertedData;
                
                // Only redraw cells that have NEW strokes from other devices
                if (cellsToRedraw.length > 0) {
                    console.log(`✅ Redrawing ${cellsToRedraw.length} cells with new strokes`);
                    cellsToRedraw.forEach(cellKey => this.redrawCell(cellKey));
                } else {
                    console.log('⏭️ No new strokes - no redraw needed');
                }
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
        console.log('Data to sync:', JSON.stringify(this.cellStrokes).substring(0, 200) + '...');
        
        const db = window.database || firebase.database();
        const strokesRef = db.ref(`rooms/${this.roomId}/cellStrokes`);
        
        if (Object.keys(this.cellStrokes).length === 0) {
            strokesRef.set(null)
                .then(() => console.log('✅ Cleared all strokes from Firebase'))
                .catch(err => console.error('❌ Sync error:', err));
        } else {
            strokesRef.set(this.cellStrokes)
                .then(() => {
                    console.log('✅ All cell strokes synced to Firebase successfully');
                    console.log('Synced cells:', Object.keys(this.cellStrokes));
                })
                .catch(err => console.error('❌ Sync error:', err));
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
