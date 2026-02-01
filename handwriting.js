// ========================
// Continuous Handwriting Recognition
// Natural Paper Writing Experience
// ========================

class ContinuousHandwritingRecognition {
    constructor(canvasId, gridElement) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.gridElement = gridElement;
        
        this.isDrawing = false;
        this.currentCell = null;
        this.cellStrokes = {}; // Store strokes per cell: {"row,col": [[{x,y,t}]]}
        this.currentStroke = [];
        
        this.gridRows = 11;
        this.gridCols = 11;
        this.cellWidth = 0;
        this.cellHeight = 0;
        this.gridOffset = { x: 0, y: 0 };
        
        this.recognitionTimeout = null;
        this.RECOGNITION_DELAY = 800; // ms after last stroke ends
        
        this.roomId = null;
        this.enabled = false;
    }

    initialize(roomId) {
        this.roomId = roomId;
        this.setupCanvas();
        this.setupEventListeners();
        
        // Only enable on touch/pen devices (mobile/tablet)
        // Desktop users will use keyboard
        if (this.isTouchDevice()) {
            this.enable();
            console.log('🖊️ Handwriting enabled (touch device detected)');
        } else {
            this.disable();
            console.log('⌨️ Handwriting disabled (desktop - use keyboard)');
        }
    }

    isTouchDevice() {
        return (('ontouchstart' in window) ||
                (navigator.maxTouchPoints > 0) ||
                (navigator.msMaxTouchPoints > 0));
    }

    setupCanvas() {
        const resizeCanvas = () => {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            
            // Calculate grid dimensions
            if (this.gridElement) {
                const gridRect = this.gridElement.getBoundingClientRect();
                const canvasRect = this.canvas.getBoundingClientRect();
                
                this.gridOffset = {
                    x: gridRect.left - canvasRect.left,
                    y: gridRect.top - canvasRect.top
                };
                
                this.cellWidth = gridRect.width / this.gridCols;
                this.cellHeight = gridRect.height / this.gridRows;
            }
            
            this.redrawAllStrokes();
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    setupEventListeners() {
        console.log('🖊️ Handwriting canvas event listeners setup');
        
        // Pointer events for stylus/touch/mouse
        this.canvas.addEventListener('pointerdown', (e) => {
            console.log('Pointer down:', e.pointerType, e.clientX, e.clientY);
            this.handlePointerDown(e);
        });
        this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
        
        // Also handle mouse events as fallback
        this.canvas.addEventListener('mousedown', (e) => {
            console.log('Mouse down:', e.clientX, e.clientY);
            this.handlePointerDown(e);
        });
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handlePointerUp(e));
    }

    getCellFromPoint(x, y) {
        const relX = x - this.gridOffset.x;
        const relY = y - this.gridOffset.y;
        
        if (relX < 0 || relY < 0) return null;
        
        const col = Math.floor(relX / this.cellWidth);
        const row = Math.floor(relY / this.cellHeight);
        
        if (row < 0 || row >= this.gridRows || col < 0 || col >= this.gridCols) {
            return null;
        }
        
        return { row, col };
    }

    handlePointerDown(e) {
        if (!this.enabled) {
            console.log('Handwriting not enabled');
            return;
        }
        
        console.log('Handling pointer down, type:', e.pointerType || 'mouse');
        
        e.preventDefault();
        this.isDrawing = true;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        console.log('Canvas position:', x, y, 'Grid offset:', this.gridOffset);
        
        const cell = this.getCellFromPoint(x, y);
        console.log('Detected cell:', cell);
        
        if (!cell) return;
        
        // Check if cell is black (blocked)
        const gridCell = app.crosswordGrid.grid[cell.row][cell.col];
        if (gridCell.isBlack) {
            console.log('Cell is black, skipping');
            this.isDrawing = false;
            return;
        }
        
        this.currentCell = cell;
        this.currentStroke = [{ x, y, t: Date.now() }];
        
        console.log('Started drawing in cell:', cell);
        
        // Initialize cell strokes if needed
        const cellKey = `${cell.row},${cell.col}`;
        if (!this.cellStrokes[cellKey]) {
            this.cellStrokes[cellKey] = [];
        }
    }

    handlePointerMove(e) {
        if (!this.isDrawing || !this.enabled) return;
        
        e.preventDefault();
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const cell = this.getCellFromPoint(x, y);
        
        // Check if moved to a new cell
        if (cell && this.currentCell && 
            (cell.row !== this.currentCell.row || cell.col !== this.currentCell.col)) {
            
            // Check if new cell is black (blocked)
            const gridCell = app.crosswordGrid.grid[cell.row][cell.col];
            if (gridCell.isBlack) {
                // Stop drawing
                this.handlePointerUp(e);
                return;
            }
            
            // Trigger recognition for previous cell
            this.finalizeCell(this.currentCell);
            
            // Start new stroke in new cell
            this.currentCell = cell;
            this.currentStroke = [{ x, y, t: Date.now() }];
            
            const cellKey = `${cell.row},${cell.col}`;
            if (!this.cellStrokes[cellKey]) {
                this.cellStrokes[cellKey] = [];
            }
        } else {
            // Continue current stroke
            this.currentStroke.push({ x, y, t: Date.now() });
            
            // Draw stroke
            this.drawStrokeSegment(
                this.currentStroke[this.currentStroke.length - 2],
                this.currentStroke[this.currentStroke.length - 1]
            );
        }
    }

    handlePointerUp(e) {
        if (!this.isDrawing) return;
        
        e.preventDefault();
        this.isDrawing = false;
        
        if (this.currentCell && this.currentStroke.length > 0) {
            // Save stroke to current cell
            const cellKey = `${this.currentCell.row},${this.currentCell.col}`;
            this.cellStrokes[cellKey].push([...this.currentStroke]);
            
            // Schedule recognition after delay
            clearTimeout(this.recognitionTimeout);
            this.recognitionTimeout = setTimeout(() => {
                this.finalizeCell(this.currentCell);
            }, this.RECOGNITION_DELAY);
        }
        
        this.currentStroke = [];
    }

    drawStrokeSegment(p1, p2) {
        if (!p1 || !p2) return;
        
        this.ctx.strokeStyle = '#E8744F';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
    }

    redrawAllStrokes() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        for (const cellKey in this.cellStrokes) {
            const strokes = this.cellStrokes[cellKey];
            for (const stroke of strokes) {
                for (let i = 1; i < stroke.length; i++) {
                    this.drawStrokeSegment(stroke[i - 1], stroke[i]);
                }
            }
        }
    }

    async finalizeCell(cell) {
        const cellKey = `${cell.row},${cell.col}`;
        const strokes = this.cellStrokes[cellKey];
        
        if (!strokes || strokes.length === 0) return;
        
        console.log(`Recognizing handwriting for cell [${cell.row},${cell.col}]...`);
        
        // Recognize handwriting using Google Digital Ink
        const recognizedText = await this.recognizeHandwriting(strokes);
        
        if (recognizedText) {
            console.log(`Recognized: "${recognizedText}"`);
            
            // Update cell with recognized text
            await app.crosswordGrid.updateCell(
                this.roomId,
                cell.row,
                cell.col,
                recognizedText
            );
            
            // Clear strokes for this cell
            this.clearCellStrokes(cellKey);
        }
    }

    async recognizeHandwriting(strokes) {
        try {
            // Check if MyScript is configured
            if (!CONFIG.MYSCRIPT_APP_KEY || !CONFIG.MYSCRIPT_HMAC_KEY) {
                console.log('MyScript not configured - skipping recognition');
                return null;
            }
            
            console.log('Recognizing with MyScript, strokes:', strokes.length);
            
            const requestData = {
                contentType: 'Text',
                configuration: {
                    lang: 'he_IL',
                    text: {
                        guides: {
                            enable: false
                        }
                    }
                },
                strokeGroups: [{
                    strokes: strokes
                }]
            };
            
            const message = JSON.stringify(requestData);
            const signature = await this.generateHMAC(CONFIG.MYSCRIPT_HMAC_KEY, message);
            
            // Call MyScript iink API
            const response = await fetch('https://cloud.myscript.com/api/v4.0/iink/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'applicationKey': CONFIG.MYSCRIPT_APP_KEY,
                    'hmac': signature
                },
                body: message
            });
            
            if (!response.ok) {
                const error = await response.json();
                console.error('MyScript API error:', error);
                return null;
            }
            
            const data = await response.json();
            console.log('MyScript response:', data);
            
            if (data.label) {
                const text = data.label;
                
                // Extract first Hebrew character
                const HEBREW_RANGE = /[\u0590-\u05FF]/;
                const match = text.match(HEBREW_RANGE);
                
                return match ? match[0] : null;
            }
            
            console.log('No label in MyScript response');
            return null;
            
        } catch (error) {
            console.error('Handwriting recognition error:', error);
            return null;
        }
    }

    async generateHMAC(key, message) {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(key);
        const messageData = encoder.encode(message);
        
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
        
        // Convert to hex string
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    clearCellStrokes(cellKey) {
        delete this.cellStrokes[cellKey];
        this.redrawAllStrokes();
    }

    enable() {
        this.enabled = true;
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.display = 'block';
    }

    disable() {
        this.enabled = false;
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.display = 'none';
    }
}
