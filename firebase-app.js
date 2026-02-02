// ========================
// Configuration & Constants
// ========================

const CONFIG = {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_TYPES: ['image/png', 'image/jpeg', 'image/jpg'],
    ROOM_ID_LENGTH: 6,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
    // MyScript iink API for Hebrew handwriting recognition
    MYSCRIPT_APP_KEY: '', // Set in settings
    MYSCRIPT_HMAC_KEY: '', // Set in settings
    HANDWRITING_DELAY: 800 // ms to wait after drawing stops
};

const HEBREW_RANGE = /^[\u0590-\u05FF]$/;

// Firebase references
const database = firebase.database();
const storage = firebase.storage();

// ========================
// Error Notifier Class
// ========================

class ErrorNotifier {
    constructor() {
        this.container = document.getElementById('error-notifications');
    }

    show(message, type = 'error') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        notification.innerHTML = `
            <span>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</span>
            <span>${message}</span>
            <button onclick="this.parentElement.remove()">×</button>
        `;
        
        this.container.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    }

    error(message) {
        this.show(message, 'error');
    }

    warning(message) {
        this.show(message, 'warning');
    }

    success(message) {
        this.show(message, 'success');
    }
}

const notifier = new ErrorNotifier();

// ========================
// Connection Monitor
// ========================

class ConnectionMonitor {
    constructor() {
        this.isOnline = true;
        this.setupConnectionHandlers();
    }

    setupConnectionHandlers() {
        // Monitor Firebase connection
        const connectedRef = database.ref('.info/connected');
        connectedRef.on('value', (snapshot) => {
            if (snapshot.val() === true) {
                this.handleReconnect();
            } else {
                this.handleDisconnect();
            }
        });

        // Also monitor browser connection
        window.addEventListener('online', () => this.handleReconnect());
        window.addEventListener('offline', () => this.handleDisconnect());
    }

    handleDisconnect() {
        this.isOnline = false;
        const banner = document.getElementById('connection-status');
        banner.classList.remove('hidden');
        notifier.warning('אין חיבור לאינטרנט - השינויים יישמרו כשהחיבור יחזור');
    }

    handleReconnect() {
        this.isOnline = true;
        const banner = document.getElementById('connection-status');
        banner.classList.add('hidden');
        
        if (!this.wasOffline) {
            this.wasOffline = true;
            return;
        }
        
        notifier.success('החיבור חזר!');
    }
}

const connectionMonitor = new ConnectionMonitor();

// ========================
// Storage Manager (Firebase)
// ========================

class StorageManager {
    async saveData(key, data) {
        try {
            await database.ref(key).set(data);
            return { success: true };
        } catch (error) {
            console.error('Storage error:', error);
            return { success: false, error: 'שגיאת שמירה' };
        }
    }

    async getData(key) {
        try {
            const snapshot = await database.ref(key).once('value');
            return snapshot.val();
        } catch (error) {
            console.error('Storage retrieval error:', error);
            return null;
        }
    }

    async deleteData(key) {
        try {
            await database.ref(key).remove();
            return { success: true };
        } catch (error) {
            console.error('Storage deletion error:', error);
            return { success: false };
        }
    }

    async uploadImage(roomId, file) {
        try {
            const storageRef = storage.ref(`crosswords/${roomId}.jpg`);
            const snapshot = await storageRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();
            return { success: true, url: downloadURL };
        } catch (error) {
            console.error('Image upload error:', error);
            return { success: false, error: 'העלאת התמונה נכשלה' };
        }
    }

    // Listen for real-time updates
    onDataChange(key, callback) {
        database.ref(key).on('value', (snapshot) => {
            callback(snapshot.val());
        });
    }

    // Stop listening
    offDataChange(key) {
        database.ref(key).off();
    }
}

const storageManager = new StorageManager();

// ========================
// Room Manager
// ========================

class RoomManager {
    constructor() {
        this.currentRoom = null;
        this.currentRoomId = null;
        this.roomListener = null;
    }

    generateRoomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < CONFIG.ROOM_ID_LENGTH; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    async roomExists(roomId) {
        const room = await storageManager.getData(`rooms/${roomId}`);
        return room !== null;
    }

    async saveToHistory(roomId, roomName, imageUrl) {
        try {
            const history = await storageManager.getData('room_history') || [];
            
            // Check if room already in history
            const existingIndex = history.findIndex(item => item.roomId === roomId);
            
            const historyItem = {
                roomId,
                name: roomName || `תשבץ ${new Date().toLocaleDateString('he-IL')}`,
                imageUrl,
                lastAccessed: Date.now(),
                createdAt: existingIndex >= 0 ? history[existingIndex].createdAt : Date.now()
            };
            
            if (existingIndex >= 0) {
                // Update existing
                history[existingIndex] = historyItem;
            } else {
                // Add new
                history.unshift(historyItem);
            }
            
            // Keep only last 50 rooms
            if (history.length > 50) {
                history.splice(50);
            }
            
            await storageManager.saveData('room_history', history);
            return { success: true };
        } catch (error) {
            console.error('Save to history error:', error);
            return { success: false };
        }
    }

    async getHistory() {
        try {
            const history = await storageManager.getData('room_history') || [];
            return history;
        } catch (error) {
            console.error('Get history error:', error);
            return [];
        }
    }

    async deleteFromHistory(roomId) {
        try {
            const history = await storageManager.getData('room_history') || [];
            const filtered = history.filter(item => item.roomId !== roomId);
            await storageManager.saveData('room_history', filtered);
            return { success: true };
        } catch (error) {
            console.error('Delete from history error:', error);
            return { success: false };
        }
    }

    async createRoom(crosswordFile, detectedGridData, detectedGridSettings) {
        try {
            let roomId = this.generateRoomId();
            let attempts = 0;
            
            // Ensure unique room ID
            while (await this.roomExists(roomId) && attempts < 10) {
                roomId = this.generateRoomId();
                attempts++;
            }
            
            if (attempts >= 10) {
                throw new Error('ROOM_ID_COLLISION');
            }

            // Upload image to Firebase Storage
            const uploadResult = await storageManager.uploadImage(roomId, crosswordFile);
            
            if (!uploadResult.success) {
                throw new Error('IMAGE_UPLOAD_FAILED');
            }

            // Use detected grid data if provided, otherwise fallback to default
            const gridSettings = detectedGridSettings || await storageManager.getData('grid_settings') || {
                rows: 11,
                cols: 11,
                position: { right: 10, top: 10, width: 80, height: 80 }
            };

            const gridData = detectedGridData || this.initializeGrid(gridSettings.rows, gridSettings.cols);

            const room = {
                id: roomId,
                crosswordImageUrl: uploadResult.url,
                grid: gridData,
                gridSettings: gridSettings,
                participants: 1,
                createdAt: Date.now()
            };

            const result = await storageManager.saveData(`rooms/${roomId}`, room);
            
            if (!result.success) {
                throw new Error('SAVE_FAILED');
            }

            this.currentRoom = room;
            this.currentRoomId = roomId;
            return { success: true, roomId, room };
            
        } catch (error) {
            console.error('Room creation error:', error);
            
            const messages = {
                'IMAGE_UPLOAD_FAILED': 'העלאת התמונה נכשלה',
                'SAVE_FAILED': 'שמירת החדר נכשלה',
                'ROOM_ID_COLLISION': 'לא הצלחנו ליצור קוד ייחודי'
            };
            
            return {
                success: false,
                error: messages[error.message] || 'לא הצלחנו ליצור חדר. נסה שוב.'
            };
        }
    }

    initializeGrid(rows, cols) {
        const grid = [];
        for (let i = 0; i < rows; i++) {
            const row = [];
            for (let j = 0; j < cols; j++) {
                row.push({
                    letter: '',
                    isBlack: false,
                    timestamp: null
                });
            }
            grid.push(row);
        }
        return grid;
    }

    async joinRoom(roomId) {
        try {
            roomId = roomId.toUpperCase().trim();
            
            if (roomId.length !== CONFIG.ROOM_ID_LENGTH) {
                throw new Error('INVALID_FORMAT');
            }

            const room = await storageManager.getData(`rooms/${roomId}`);
            
            if (!room) {
                throw new Error('ROOM_NOT_FOUND');
            }

            // Increment participants
            room.participants++;
            await storageManager.saveData(`rooms/${roomId}`, room);

            this.currentRoom = room;
            this.currentRoomId = roomId;
            return { success: true, room };
            
        } catch (error) {
            const messages = {
                'INVALID_FORMAT': 'קוד החדר לא תקין. בדוק שוב.',
                'ROOM_NOT_FOUND': 'החדר לא נמצא. בדוק את הקוד.',
            };
            
            return {
                success: false,
                error: messages[error.message] || 'שגיאה לא צפויה'
            };
        }
    }

    async updateCell(roomId, row, col, letter) {
        try {
            await database.ref(`rooms/${roomId}/grid/${row}/${col}`).update({
                letter: letter,
                timestamp: Date.now()
            });
            
            return { success: true };
        } catch (error) {
            console.error('Cell update error:', error);
            return { success: false };
        }
    }

    async leaveRoom(roomId) {
        try {
            // Stop listening to updates
            if (this.roomListener) {
                storageManager.offDataChange(`rooms/${roomId}`);
                this.roomListener = null;
            }

            const room = await storageManager.getData(`rooms/${roomId}`);
            if (room) {
                room.participants = Math.max(0, room.participants - 1);
                await storageManager.saveData(`rooms/${roomId}`, room);
            }
            
            this.currentRoomId = null;
            this.currentRoom = null;
        } catch (error) {
            console.error('Leave room error:', error);
        }
    }

    // Listen for real-time updates to room
    listenToRoom(roomId, callback) {
        this.roomListener = true;
        storageManager.onDataChange(`rooms/${roomId}`, callback);
    }
}

const roomManager = new RoomManager();

// ========================
// Grid Detector (OpenCV)
// ========================

class GridDetector {
    constructor() {
        this.GRID_SIZE = 11; // Always 11x11
        this.BLOCK_THRESHOLD = 100; // Pixel intensity threshold for black cells
    }

    async waitForOpenCV() {
        return new Promise((resolve) => {
            if (typeof cv !== 'undefined') {
                resolve();
            } else {
                const checkInterval = setInterval(() => {
                    if (typeof cv !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            }
        });
    }

    async detectGrid(imageElement) {
        await this.waitForOpenCV();

        try {
            // Load image into OpenCV Mat
            const src = cv.imread(imageElement);
            
            // Convert to grayscale
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            
            // Apply adaptive thresholding to handle lighting/shadows
            const thresh = new cv.Mat();
            cv.adaptiveThreshold(
                gray, 
                thresh, 
                255, 
                cv.ADAPTIVE_THRESH_GAUSSIAN_C, 
                cv.THRESH_BINARY_INV, 
                11, 
                2
            );
            
            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(
                thresh, 
                contours, 
                hierarchy, 
                cv.RETR_EXTERNAL, 
                cv.CHAIN_APPROX_SIMPLE
            );
            
            // Find the largest 4-sided contour (the grid)
            let maxArea = 0;
            let gridContour = null;
            
            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);
                
                // Approximate contour to polygon
                const peri = cv.arcLength(contour, true);
                const approx = new cv.Mat();
                cv.approxPolyDP(contour, approx, 0.02 * peri, true);
                
                // Check if it's a quadrilateral and is the largest
                if (approx.rows === 4 && area > maxArea) {
                    maxArea = area;
                    if (gridContour) gridContour.delete();
                    gridContour = approx;
                } else {
                    approx.delete();
                }
                
                contour.delete();
            }
            
            if (!gridContour) {
                throw new Error('GRID_NOT_FOUND');
            }
            
            // Get the 4 corner points
            const corners = this.orderPoints(gridContour);
            
            // Apply perspective transform to warp grid to perfect square
            const warpedSize = 550; // Output size
            const warped = this.fourPointTransform(src, corners, warpedSize);
            
            // Detect black cells
            const gridData = this.detectBlackCells(warped, this.GRID_SIZE);
            
            // Calculate grid positioning relative to image
            const gridSettings = this.calculateGridPosition(corners, src.cols, src.rows);
            
            // Cleanup
            src.delete();
            gray.delete();
            thresh.delete();
            contours.delete();
            hierarchy.delete();
            gridContour.delete();
            warped.delete();
            
            return {
                success: true,
                gridData,
                gridSettings
            };
            
        } catch (error) {
            console.error('Grid detection error:', error);
            
            if (error.message === 'GRID_NOT_FOUND') {
                return {
                    success: false,
                    error: 'לא נמצאה רשת בתמונה. ודא שהרשת מוקפת במסגרת שחורה.'
                };
            }
            
            return {
                success: false,
                error: 'שגיאה בזיהוי הרשת. נסה תמונה אחרת.'
            };
        }
    }

    orderPoints(contour) {
        // Order points: top-right, top-left, bottom-left, bottom-right (for RTL)
        const points = [];
        for (let i = 0; i < contour.rows; i++) {
            points.push({
                x: contour.data32S[i * 2],
                y: contour.data32S[i * 2 + 1]
            });
        }
        
        // Sort by y-coordinate
        points.sort((a, b) => a.y - b.y);
        
        // Top two points
        const topPoints = points.slice(0, 2);
        const bottomPoints = points.slice(2, 4);
        
        // Sort top points by x (right to left for RTL)
        topPoints.sort((a, b) => b.x - a.x);
        
        // Sort bottom points by x (right to left for RTL)
        bottomPoints.sort((a, b) => b.x - a.x);
        
        return [
            topPoints[0],    // top-right
            topPoints[1],    // top-left
            bottomPoints[1], // bottom-left
            bottomPoints[0]  // bottom-right
        ];
    }

    fourPointTransform(src, corners, size) {
        // Destination points for perfect square
        const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
            size - 1, 0,        // top-right
            0, 0,               // top-left
            0, size - 1,        // bottom-left
            size - 1, size - 1  // bottom-right
        ]);
        
        // Source points from corners
        const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
            corners[0].x, corners[0].y,
            corners[1].x, corners[1].y,
            corners[2].x, corners[2].y,
            corners[3].x, corners[3].y
        ]);
        
        // Get perspective transform matrix
        const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
        
        // Warp the image
        const warped = new cv.Mat();
        cv.warpPerspective(
            src, 
            warped, 
            M, 
            new cv.Size(size, size),
            cv.INTER_LINEAR,
            cv.BORDER_CONSTANT,
            new cv.Scalar(255, 255, 255, 255)
        );
        
        srcPoints.delete();
        dstPoints.delete();
        M.delete();
        
        return warped;
    }

    detectBlackCells(warpedImage, gridSize) {
        console.log('🔍 BLACK CELL DETECTION STARTED (NEW METHOD: BRIGHTNESS COMPARISON)');
        console.log('Grid size:', gridSize, 'Image size:', warpedImage.rows, 'x', warpedImage.cols);
        
        // Convert to grayscale
        const gray = new cv.Mat();
        cv.cvtColor(warpedImage, gray, cv.COLOR_RGBA2GRAY, 0);
        
        const cellSize = warpedImage.rows / gridSize;
        
        // First pass: calculate average brightness of each cell
        const cellBrightness = [];
        
        for (let row = 0; row < gridSize; row++) {
            const rowBrightness = [];
            
            for (let col = 0; col < gridSize; col++) {
                const cellStartX = Math.floor(col * cellSize);
                const cellStartY = Math.floor(row * cellSize);
                const cellEndX = Math.min(Math.floor((col + 1) * cellSize), gray.cols);
                const cellEndY = Math.min(Math.floor((row + 1) * cellSize), gray.rows);
                
                // Check center 50% to avoid borders
                const margin = cellSize * 0.25;
                const startX = Math.floor(cellStartX + margin);
                const startY = Math.floor(cellStartY + margin);
                const endX = Math.floor(cellEndX - margin);
                const endY = Math.floor(cellEndY - margin);
                
                let brightnessSum = 0;
                let pixelCount = 0;
                
                for (let y = startY; y < endY; y++) {
                    for (let x = startX; x < endX; x++) {
                        brightnessSum += gray.ucharPtr(y, x)[0];
                        pixelCount++;
                    }
                }
                
                const avgBrightness = pixelCount > 0 ? brightnessSum / pixelCount : 255;
                rowBrightness.push(avgBrightness);
            }
            
            cellBrightness.push(rowBrightness);
        }
        
        // Calculate overall average brightness
        let totalBrightness = 0;
        let totalCells = 0;
        for (let row of cellBrightness) {
            for (let brightness of row) {
                totalBrightness += brightness;
                totalCells++;
            }
        }
        const avgBrightness = totalBrightness / totalCells;
        
        console.log(`Average grid brightness: ${avgBrightness.toFixed(1)}`);
        
        // Second pass: mark cells as black if they're significantly darker than average
        const grid = [];
        const threshold = avgBrightness * 0.4; // Black cells are less than 40% of average brightness
        
        for (let row = 0; row < gridSize; row++) {
            const gridRow = [];
            
            for (let col = 0; col < gridSize; col++) {
                const brightness = cellBrightness[row][col];
                const isBlack = brightness < threshold;
                
                // Debug: log first few cells
                if (row === 0 && col < 3) {
                    console.log(`Cell [${row},${col}]: brightness=${brightness.toFixed(1)}, threshold=${threshold.toFixed(1)}, isBlack=${isBlack}`);
                }
                
                gridRow.push({
                    letter: '',
                    isBlack: isBlack,
                    timestamp: null
                });
            }
            
            grid.push(gridRow);
        }
        
        // Count total black cells for debugging
        let totalBlackCells = 0;
        for (let row of grid) {
            for (let cell of row) {
                if (cell.isBlack) totalBlackCells++;
            }
        }
        console.log(`Total black cells detected: ${totalBlackCells} out of 121`);
        
        gray.delete();
        return grid;
    }

    calculateGridPosition(corners, imageWidth, imageHeight) {
        // Calculate bounding box of the grid
        const minX = Math.min(...corners.map(p => p.x));
        const maxX = Math.max(...corners.map(p => p.x));
        const minY = Math.min(...corners.map(p => p.y));
        const maxY = Math.max(...corners.map(p => p.y));
        
        // Convert to percentages (right, top, width, height)
        const right = ((imageWidth - maxX) / imageWidth) * 100;
        const top = (minY / imageHeight) * 100;
        const width = ((maxX - minX) / imageWidth) * 100;
        const height = ((maxY - minY) / imageHeight) * 100;
        
        return {
            rows: this.GRID_SIZE,
            cols: this.GRID_SIZE,
            position: {
                right: Math.round(right * 100) / 100,
                top: Math.round(top * 100) / 100,
                width: Math.round(width * 100) / 100,
                height: Math.round(height * 100) / 100
            }
        };
    }
}

const gridDetector = new GridDetector();

// ========================
// Crossword Grid Manager
// ========================

class CrosswordGrid {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.activeCell = null;
        this.grid = null;
        this.rows = 0;
        this.cols = 0;
        this.currentDirection = 'horizontal'; // 'horizontal' or 'vertical'
        this.lastClickTime = 0;
        this.doubleClickDelay = 300; // ms
    }

    async initialize(roomId, gridData, gridSettings) {
        this.grid = gridData;
        this.rows = gridData.length;
        this.cols = gridData[0].length;

        // Wait for image to load to get its dimensions
        const imageContainer = document.getElementById('crossword-image-container');
        const image = document.getElementById('crossword-image');
        
        const imageLoaded = new Promise((resolve) => {
            if (image.complete) {
                resolve();
            } else {
                image.onload = () => resolve();
            }
        });
        
        await imageLoaded;

        // Apply grid positioning relative to IMAGE, not container
        if (gridSettings && gridSettings.position) {
            const pos = gridSettings.position;
            const imageRect = image.getBoundingClientRect();
            const containerRect = imageContainer.getBoundingClientRect();
            
            // Calculate position relative to image
            const imageRight = containerRect.right - imageRect.right;
            const imageTop = imageRect.top - containerRect.top;
            
            const gridRight = imageRight + (imageRect.width * pos.right / 100);
            const gridTop = imageTop + (imageRect.height * pos.top / 100);
            const gridWidth = imageRect.width * pos.width / 100;
            const gridHeight = imageRect.height * pos.height / 100;
            
            // Lock dimensions in pixels (prevents keyboard resize issues)
            this.container.style.right = `${gridRight}px`;
            this.container.style.top = `${gridTop}px`;
            this.container.style.width = `${gridWidth}px`;
            this.container.style.height = `${gridHeight}px`;
            
            // Store original dimensions for potential resets
            this.originalDimensions = { gridRight, gridTop, gridWidth, gridHeight };
        }

        // Set grid template
        this.container.style.gridTemplateRows = `repeat(${this.rows}, 1fr)`;
        this.container.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;

        // Clear existing grid
        this.container.innerHTML = '';

        // Create cells
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const cell = this.createCell(roomId, row, col, gridData[row][col]);
                this.container.appendChild(cell);
            }
        }
    }

    createCell(roomId, row, col, cellData) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.row = row;
        cell.dataset.col = col;

        if (cellData.isBlack) {
            // Black/blocked cell
            cell.classList.add('black-cell');
            return cell;
        }

        // Playable white cell
        const letterSpan = document.createElement('span');
        letterSpan.className = 'cell-letter';
        letterSpan.textContent = cellData.letter;
        cell.appendChild(letterSpan);
        
        if (cellData.letter) {
            cell.classList.add('has-letter');
        }

        // Add canvas for handwriting (only on mobile with stylus support)
        if (this.isMobile() && CONFIG.HANDWRITING_ENABLED) {
            const canvas = document.createElement('canvas');
            canvas.className = 'cell-canvas';
            canvas.width = 100;
            canvas.height = 100;
            cell.appendChild(canvas);
            
            this.setupHandwriting(cell, canvas, roomId, row, col);
        }

        cell.addEventListener('click', () => {
            this.selectCell(roomId, row, col);
            
            // On mobile: ensure keyboard opens
            if (this.isMobile()) {
                const input = cell.querySelector('.cell-input');
                if (input) {
                    // Small delay to ensure selectCell completes first
                    setTimeout(() => {
                        input.focus();
                    }, 50);
                }
            }
        });
        
        // Add hidden input for mobile native keyboard
        if (this.isMobile()) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'cell-input';
            input.maxLength = 1;
            input.autocomplete = 'off';
            input.autocorrect = 'off';
            input.autocapitalize = 'off';
            input.spellcheck = false;
            input.inputMode = 'text';
            
            // Prevent zoom on iOS
            input.style.fontSize = '16px';
            
            // Handle input from native keyboard
            input.addEventListener('input', async (e) => {
                const char = e.target.value;
                if (HEBREW_RANGE.test(char)) {
                    await this.updateCell(roomId, row, col, char);
                    
                    // Move to next cell
                    const next = this.getNextCell(row, col);
                    if (next) {
                        // Don't blur - keep keyboard open
                        this.selectCell(roomId, next.row, next.col);
                    }
                }
                e.target.value = '';
            });
            
            // Handle backspace
            input.addEventListener('keydown', async (e) => {
                if (e.key === 'Backspace') {
                    await this.updateCell(roomId, row, col, '');
                    
                    // Move to previous cell
                    const prev = this.getPreviousCell(row, col);
                    if (prev) {
                        // Don't blur - keep keyboard open
                        this.selectCell(roomId, prev.row, prev.col);
                    }
                }
            });
            
            // Prevent scroll on focus
            input.addEventListener('focus', (e) => {
                // Prevent default scroll behavior
                e.preventDefault();
                
                // Keep viewport stable
                const scrollX = window.scrollX;
                const scrollY = window.scrollY;
                
                setTimeout(() => {
                    window.scrollTo(scrollX, scrollY);
                }, 0);
            });
            
            cell.appendChild(input);
        }

        return cell;
    }

    setupPCKeyboard(roomId) {
        // Handle keyboard input on PC (direct typing)
        document.addEventListener('keydown', async (e) => {
            if (this.isMobile()) return;
            if (!this.activeCell) return;
            
            const row = parseInt(this.activeCell.dataset.row);
            const col = parseInt(this.activeCell.dataset.col);
            
            if (e.key === 'Backspace') {
                e.preventDefault();
                await this.updateCell(roomId, row, col, '');
                
                // Move to previous cell
                const prev = this.getPreviousCell(row, col);
                if (prev) {
                    this.selectCell(roomId, prev.row, prev.col);
                }
            } else if (HEBREW_RANGE.test(e.key)) {
                e.preventDefault();
                await this.updateCell(roomId, row, col, e.key);
                
                // Move to next cell
                const next = this.getNextCell(row, col);
                if (next) {
                    this.selectCell(roomId, next.row, next.col);
                }
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.handleArrowKey(e.key, row, col, roomId);
            }
        });
    }

    handleArrowKey(key, row, col, roomId) {
        let newRow = row;
        let newCol = col;
        
        switch(key) {
            case 'ArrowUp':
                if (row > 0) newRow = row - 1;
                break;
            case 'ArrowDown':
                if (row < this.rows - 1) newRow = row + 1;
                break;
            case 'ArrowLeft':
                if (col < this.cols - 1) newCol = col + 1; // RTL
                break;
            case 'ArrowRight':
                if (col > 0) newCol = col - 1; // RTL
                break;
        }
        
        // Skip black cells
        if (!this.grid[newRow][newCol].isBlack) {
            this.selectCell(roomId, newRow, newCol);
        }
    }

    setupHandwriting(cell, canvas, roomId, row, col) {
        const ctx = canvas.getContext('2d');
        let isDrawing = false;
        let lastDrawTime = 0;
        let recognitionTimeout = null;
        let strokes = [];
        let currentStroke = [];

        // Style the canvas
        ctx.strokeStyle = '#E8744F';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const startDrawing = (e) => {
            console.log('Touch detected!', {
                touches: e.touches ? e.touches.length : 0,
                touchType: e.touches?.[0]?.touchType,
                force: e.touches?.[0]?.force,
                radiusX: e.touches?.[0]?.radiusX
            });
            
            // Check if this is Apple Pencil (has pressure, not just a finger tap)
            const isApplePencil = e.touches && e.touches[0] && 
                                 (e.touches[0].touchType === 'stylus' || 
                                  e.touches[0].force > 0 ||
                                  e.touches[0].radiusX < 10); // Pencil has smaller radius
            
            console.log('Is Apple Pencil?', isApplePencil);
            
            // Only handle drawing if it's Apple Pencil, not finger
            if (!isApplePencil && e.touches) {
                console.log('Not Apple Pencil - ignoring for keyboard');
                return; // Let the normal click handler deal with finger taps
            }
            
            console.log('Starting to draw...');
            
            // Enable pointer events for drawing
            canvas.style.pointerEvents = 'auto';
            
            e.preventDefault();
            e.stopPropagation();
            
            // Auto-select this cell when starting to draw
            this.selectCell(roomId, row, col);
            
            isDrawing = true;
            lastDrawTime = Date.now();
            
            const rect = canvas.getBoundingClientRect();
            const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
            const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
            
            currentStroke = [{x, y}];
            ctx.beginPath();
            ctx.moveTo(x, y);
            
            // Clear recognition timeout
            if (recognitionTimeout) {
                clearTimeout(recognitionTimeout);
            }
        };

        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            e.stopPropagation();
            
            const rect = canvas.getBoundingClientRect();
            const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
            const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
            
            currentStroke.push({x, y});
            ctx.lineTo(x, y);
            ctx.stroke();
            
            lastDrawTime = Date.now();
        };

        const endDrawing = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            e.stopPropagation();
            
            isDrawing = false;
            strokes.push([...currentStroke]);
            
            // Disable pointer events after drawing
            canvas.style.pointerEvents = 'none';
            
            // Auto-recognize after delay
            recognitionTimeout = setTimeout(async () => {
                if (strokes.length > 0) {
                    await this.recognizeHandwriting(canvas, roomId, row, col);
                    // Clear canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    strokes = [];
                }
            }, CONFIG.HANDWRITING_DELAY);
        };

        // Touch events (for iPad/stylus)
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', endDrawing, { passive: false });
        
        // Mouse events (fallback)
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', endDrawing);
    }

    async recognizeHandwriting(canvas, roomId, row, col) {
        if (!CONFIG.AZURE_ENDPOINT || !CONFIG.AZURE_KEY) {
            notifier.warning('זיהוי כתב יד לא מוגדר');
            return;
        }

        try {
            // Convert canvas to blob
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            
            // Call Azure Computer Vision API
            const response = await fetch(
                `${CONFIG.AZURE_ENDPOINT}/vision/v3.2/read/analyze`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Ocp-Apim-Subscription-Key': CONFIG.AZURE_KEY
                    },
                    body: blob
                }
            );

            if (!response.ok) {
                throw new Error('API_ERROR');
            }

            // Get operation location
            const operationLocation = response.headers.get('Operation-Location');
            
            // Poll for results
            let result;
            let attempts = 0;
            while (attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const resultResponse = await fetch(operationLocation, {
                    headers: {
                        'Ocp-Apim-Subscription-Key': CONFIG.AZURE_KEY
                    }
                });
                
                result = await resultResponse.json();
                
                if (result.status === 'succeeded') {
                    break;
                }
                
                attempts++;
            }

            if (result.status === 'succeeded' && result.analyzeResult?.readResults?.[0]?.lines?.length > 0) {
                const text = result.analyzeResult.readResults[0].lines[0].text;
                
                // Extract first Hebrew character
                const hebrewChar = text.match(HEBREW_RANGE);
                if (hebrewChar) {
                    await this.updateCell(roomId, row, col, hebrewChar[0]);
                    
                    // Move to next cell
                    const next = this.getNextCell(row, col);
                    if (next) {
                        this.selectCell(roomId, next.row, next.col);
                    }
                } else {
                    notifier.warning('לא זוהתה אות עברית');
                }
            } else {
                notifier.warning('לא הצלחנו לזהות את האות');
            }
        } catch (error) {
            console.error('Handwriting recognition error:', error);
            notifier.error('שגיאה בזיהוי כתב יד');
        }
    }

    selectCell(roomId, row, col) {
        const now = Date.now();
        const timeSinceLastClick = now - this.lastClickTime;
        
        // Check if this is a double-click on the SAME cell
        const isSameCell = this.activeCell && 
                          this.activeCell.dataset.row == row && 
                          this.activeCell.dataset.col == col;
        
        // Only toggle direction if it's the SAME cell AND within double-click time
        if (isSameCell && timeSinceLastClick < this.doubleClickDelay && timeSinceLastClick > 50) {
            // Double-click: toggle direction
            this.currentDirection = this.currentDirection === 'horizontal' ? 'vertical' : 'horizontal';
            notifier.success(`כיוון: ${this.currentDirection === 'horizontal' ? 'אופקי' : 'אנכי'}`);
            this.lastClickTime = 0; // Reset to prevent triple-click
            this.clearWordHighlight();
            this.highlightWord(row, col);
            return;
        }
        
        this.lastClickTime = now;

        // Remove previous active state
        if (this.activeCell) {
            this.activeCell.classList.remove('active');
        }
        
        // Clear previous word highlights
        this.clearWordHighlight();

        // Set new active cell
        const cell = this.container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (cell && !cell.classList.contains('black-cell')) {
            cell.classList.add('active');
            this.activeCell = cell;
            
            // Highlight the current word
            this.highlightWord(row, col);

            // On mobile: focus hidden input to trigger native keyboard
            if (this.isMobile()) {
                const input = cell.querySelector('.cell-input');
                if (input) {
                    // Prevent page scroll when focusing
                    const scrollX = window.scrollX;
                    const scrollY = window.scrollY;
                    
                    // Focus immediately for iPad keyboard
                    input.focus({ preventScroll: true });
                    
                    // Restore scroll position
                    setTimeout(() => {
                        window.scrollTo(scrollX, scrollY);
                    }, 0);
                }
            }
        }
    }

    highlightWord(row, col) {
        // Highlight all cells in the current direction until black cell or edge
        const cells = this.getWordCells(row, col);
        
        cells.forEach(({r, c}) => {
            const cell = this.container.querySelector(`[data-row="${r}"][data-col="${c}"]`);
            if (cell && !cell.classList.contains('active')) {
                cell.classList.add('word-highlight');
            }
        });
    }

    clearWordHighlight() {
        this.container.querySelectorAll('.word-highlight').forEach(cell => {
            cell.classList.remove('word-highlight');
        });
    }

    getWordCells(row, col) {
        const cells = [];
        
        if (this.currentDirection === 'horizontal') {
            // Go right (col decreases)
            for (let c = col - 1; c >= 0; c--) {
                if (this.grid[row][c].isBlack) break;
                cells.push({r: row, c: c});
            }
            
            // Go left (col increases)
            for (let c = col + 1; c < this.cols; c++) {
                if (this.grid[row][c].isBlack) break;
                cells.push({r: row, c: c});
            }
        } else {
            // Go up
            for (let r = row - 1; r >= 0; r--) {
                if (this.grid[r][col].isBlack) break;
                cells.push({r: r, c: col});
            }
            
            // Go down
            for (let r = row + 1; r < this.rows; r++) {
                if (this.grid[r][col].isBlack) break;
                cells.push({r: r, c: col});
            }
        }
        
        return cells;
    }

    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    updateCellDisplay(row, col, letter) {
        const cell = this.container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) return;

        const letterSpan = cell.querySelector('.cell-letter');
        if (letterSpan) {
            letterSpan.textContent = letter;
        } else {
            cell.textContent = letter;
        }
        
        cell.classList.toggle('has-letter', letter !== '');
        
        // Clear canvas if exists
        const canvas = cell.querySelector('.cell-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    async updateCell(roomId, row, col, letter) {
        // Optimistic update - show immediately
        this.updateCellDisplay(row, col, letter);

        // Sync to Firebase (will propagate to all users)
        const result = await roomManager.updateCell(roomId, row, col, letter);
        
        if (!result.success) {
            notifier.error('לא הצלחנו לשמור. מנסים שוב...');
        }
    }

    getNextCell(row, col) {
        if (this.currentDirection === 'horizontal') {
            // Move left (Hebrew direction: col increases)
            for (let c = col + 1; c < this.cols; c++) {
                if (!this.grid[row][c].isBlack) {
                    return { row, col: c };
                }
            }

            // Wrap to next row (start from rightmost = col 0)
            for (let r = row + 1; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    if (!this.grid[r][c].isBlack) {
                        return { row: r, col: c };
                    }
                }
            }
        } else {
            // Move down (vertical)
            for (let r = row + 1; r < this.rows; r++) {
                if (!this.grid[r][col].isBlack) {
                    return { row: r, col };
                }
            }

            // Wrap to next column
            for (let c = col + 1; c < this.cols; c++) {
                for (let r = 0; r < this.rows; r++) {
                    if (!this.grid[r][c].isBlack) {
                        return { row: r, col: c };
                    }
                }
            }
        }

        return null;
    }

    getPreviousCell(row, col) {
        if (this.currentDirection === 'horizontal') {
            // Move right (Hebrew backward: col decreases)
            for (let c = col - 1; c >= 0; c--) {
                if (!this.grid[row][c].isBlack) {
                    return { row, col: c };
                }
            }

            // Wrap to previous row (start from leftmost = last col)
            for (let r = row - 1; r >= 0; r--) {
                for (let c = this.cols - 1; c >= 0; c--) {
                    if (!this.grid[r][c].isBlack) {
                        return { row: r, col: c };
                    }
                }
            }
        } else {
            // Move up (vertical)
            for (let r = row - 1; r >= 0; r--) {
                if (!this.grid[r][col].isBlack) {
                    return { row: r, col };
                }
            }

            // Wrap to previous column
            for (let c = col - 1; c >= 0; c--) {
                for (let r = this.rows - 1; r >= 0; r--) {
                    if (!this.grid[r][c].isBlack) {
                        return { row: r, col: c };
                    }
                }
            }
        }

        return null;
    }
}

// ========================
// Hebrew Keyboard Manager
// ========================

class HebrewKeyboard {
    constructor() {
        this.container = document.getElementById('hebrew-keyboard');
        this.cellInfo = document.getElementById('keyboard-cell-info');
        this.currentRow = null;
        this.currentCol = null;
        this.currentRoomId = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Virtual keyboard keys
        document.querySelectorAll('.key').forEach(key => {
            key.addEventListener('click', () => {
                const char = key.dataset.char;
                const action = key.dataset.action;

                if (action === 'backspace') {
                    this.handleBackspace();
                } else if (char) {
                    this.handleInput(char);
                }
            });
        });

        // Physical keyboard
        document.addEventListener('keydown', (e) => {
            if (!this.isVisible()) return;

            if (e.key === 'Backspace') {
                e.preventDefault();
                this.handleBackspace();
            } else if (HEBREW_RANGE.test(e.key)) {
                e.preventDefault();
                this.handleInput(e.key);
            } else if (e.key === 'Escape') {
                this.hide();
            }
        });

        // Close button
        document.getElementById('keyboard-close').addEventListener('click', () => {
            this.hide();
        });
    }

    show(roomId, row, col) {
        this.currentRoomId = roomId;
        this.currentRow = row;
        this.currentCol = col;
        this.cellInfo.textContent = `תא (${row + 1}, ${col + 1})`;
        this.container.classList.remove('hidden');
    }

    hide() {
        this.container.classList.add('hidden');
        this.currentRoomId = null;
        this.currentRow = null;
        this.currentCol = null;
    }

    isVisible() {
        return !this.container.classList.contains('hidden');
    }

    async handleInput(char) {
        if (!HEBREW_RANGE.test(char)) {
            notifier.error('רק אותיות עבריות מותרות');
            return;
        }

        await app.crosswordGrid.updateCell(
            this.currentRoomId,
            this.currentRow,
            this.currentCol,
            char
        );

        // Move to next cell
        const next = app.crosswordGrid.getNextCell(this.currentRow, this.currentCol);
        if (next) {
            app.crosswordGrid.selectCell(this.currentRoomId, next.row, next.col);
        }
    }

    async handleBackspace() {
        // Clear current cell
        await app.crosswordGrid.updateCell(
            this.currentRoomId,
            this.currentRow,
            this.currentCol,
            ''
        );

        // Move to previous cell
        const prev = app.crosswordGrid.getPreviousCell(this.currentRow, this.currentCol);
        if (prev) {
            app.crosswordGrid.selectCell(this.currentRoomId, prev.row, prev.col);
        }
    }
}

// ========================
// Main Application
// ========================

class CrosswordApp {
    constructor() {
        this.currentScreen = 'home-screen';
        this.crosswordGrid = new CrosswordGrid('#crossword-grid');
        this.keyboard = new HebrewKeyboard();
        this.selectedFile = null;
        this.initializeTheme();
        this.setupEventListeners();
        this.showScreen('home-screen');
    }

    initializeTheme() {
        // Check for saved theme preference, default to dark
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.setTheme(savedTheme);
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        const themeIcon = document.querySelector('.theme-icon');
        if (themeIcon) {
            themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
        }
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }

    setupEventListeners() {
        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => {
            this.toggleTheme();
        });

        // Navigation
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.showScreen('create-screen');
        });

        document.getElementById('join-room-btn').addEventListener('click', () => {
            this.showScreen('join-screen');
        });

        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showScreen('settings-screen');
        });

        document.getElementById('history-btn').addEventListener('click', () => {
            this.showHistoryScreen();
        });

        // Back buttons
        document.getElementById('back-from-create').addEventListener('click', () => {
            this.showScreen('home-screen');
        });

        document.getElementById('back-from-join').addEventListener('click', () => {
            this.showScreen('home-screen');
        });

        document.getElementById('back-from-settings').addEventListener('click', () => {
            this.showScreen('home-screen');
        });

        document.getElementById('back-from-history').addEventListener('click', () => {
            this.showScreen('home-screen');
        });

        document.getElementById('back-from-room').addEventListener('click', () => {
            this.leaveRoom();
        });

        // File upload
        this.setupFileUpload();

        // Room creation
        document.getElementById('create-room-submit').addEventListener('click', () => {
            this.createRoom();
        });

        // Room joining
        document.getElementById('join-room-submit').addEventListener('click', () => {
            this.joinRoom();
        });

        // Settings
        document.getElementById('save-settings').addEventListener('click', () => {
            this.saveSettings();
        });

        document.getElementById('reset-grid').addEventListener('click', () => {
            this.resetGrid();
        });

        // Copy room ID
        document.getElementById('copy-room-id').addEventListener('click', () => {
            this.copyRoomId();
        });

        // Settings preview updates
        document.getElementById('grid-rows').addEventListener('input', () => this.updateGridPreview());
        document.getElementById('grid-cols').addEventListener('input', () => this.updateGridPreview());
        document.getElementById('show-grid-lines').addEventListener('change', () => this.updateGridPreview());

        // Azure handwriting settings
        document.getElementById('test-myscript').addEventListener('click', () => {
            this.testMyScriptConnection();
        });

        // Handwriting test canvas
        this.setupTestCanvas();

        document.getElementById('clear-test-canvas').addEventListener('click', () => {
            this.clearTestCanvas();
        });

        document.getElementById('recognize-test').addEventListener('click', () => {
            this.recognizeTestHandwriting();
        });

        // Template image upload
        document.getElementById('upload-template-image').addEventListener('click', () => {
            document.getElementById('template-image-upload').click();
        });

        document.getElementById('template-image-upload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadTemplateImage(file);
            }
        });

        // Setup draggable grid overlay
        this.setupDraggableGrid();
    }

    async testMyScriptConnection() {
        const appKey = document.getElementById('myscript-app-key').value.trim();
        const hmacKey = document.getElementById('myscript-hmac-key').value.trim();

        if (!appKey || !hmacKey) {
            notifier.error('מלא את שני המפתחות');
            return;
        }

        try {
            notifier.warning('בודק חיבור...');
            
            // Test with a simple stroke - use correct API format
            const testData = {
                contentType: 'Text',
                configuration: {
                    lang: 'he_IL'
                },
                strokes: [{
                    x: [100, 150, 200],
                    y: [100, 150, 100],
                    t: [0, 100, 200]
                }]
            };
            
            // Generate HMAC signature
            const message = JSON.stringify(testData);
            const signature = await this.generateHMAC(hmacKey, message);
            
            const response = await fetch('https://cloud.myscript.com/api/v4.0/iink/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'applicationKey': appKey,
                    'hmac': signature
                },
                body: message
            });

            if (response.ok) {
                CONFIG.MYSCRIPT_APP_KEY = appKey;
                CONFIG.MYSCRIPT_HMAC_KEY = hmacKey;
                await storageManager.saveData('myscript_config', { appKey, hmacKey });
                notifier.success('החיבור תקין! ✅');
            } else {
                const error = await response.json();
                console.error('MyScript error:', error);
                notifier.error('המפתחות שגויים או ההרשאות לא נכונות');
            }
        } catch (error) {
            console.error('Connection test error:', error);
            notifier.error('לא הצלחנו להתחבר ל-MyScript');
        }
    }

    async generateHMAC(key, message) {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(key);
        const messageData = encoder.encode(message);
        
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-512' },
            false,
            ['sign']
        );
        
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
        
        // Convert to hex string
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    setupTestCanvas() {
        const canvas = document.getElementById('test-handwriting-canvas');
        const ctx = canvas.getContext('2d');
        
        // Set larger canvas size for better recognition
        canvas.width = 400;
        canvas.height = 300;
        
        let isDrawing = false;
        let currentStroke = [];
        this.testStrokes = []; // Store all strokes for MyScript
        
        // Clear canvas
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const startDrawing = (e) => {
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = ((e.clientX || e.touches[0].clientX) - rect.left) * scaleX;
            const y = ((e.clientY || e.touches[0].clientY) - rect.top) * scaleY;
            
            currentStroke = [[x, y, Date.now()]];
        };
        
        const draw = (e) => {
            if (!isDrawing) return;
            
            e.preventDefault();
            
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = ((e.clientX || e.touches[0].clientX) - rect.left) * scaleX;
            const y = ((e.clientY || e.touches[0].clientY) - rect.top) * scaleY;
            
            currentStroke.push([x, y, Date.now()]);
            
            // Draw
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            const prev = currentStroke[currentStroke.length - 2];
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(x, y);
            ctx.stroke();
        };
        
        const stopDrawing = () => {
            if (!isDrawing) return;
            isDrawing = false;
            
            if (currentStroke.length > 0) {
                this.testStrokes.push(currentStroke);
            }
            currentStroke = [];
        };
        
        // Mouse events
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
        
        // Touch events
        canvas.addEventListener('touchstart', startDrawing);
        canvas.addEventListener('touchmove', draw);
        canvas.addEventListener('touchend', stopDrawing);
    }

    clearTestCanvas() {
        const canvas = document.getElementById('test-handwriting-canvas');
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Clear strokes
        this.testStrokes = [];
        
        // Hide result
        document.getElementById('test-result').classList.add('hidden');
    }

    async recognizeTestHandwriting() {
        if (!CONFIG.MYSCRIPT_APP_KEY || !CONFIG.MYSCRIPT_HMAC_KEY) {
            notifier.error('הגדר מפתחות MyScript בהגדרות');
            return;
        }
        
        if (!this.testStrokes || this.testStrokes.length === 0) {
            notifier.error('צייר משהו קודם!');
            return;
        }
        
        try {
            notifier.warning('מזהה...');
            
            // Convert stroke format: [[x,y,t]] -> {x:[], y:[], t:[]}
            const convertedStrokes = this.testStrokes.map(stroke => ({
                x: stroke.map(p => p[0]),
                y: stroke.map(p => p[1]),
                t: stroke.map(p => p[2])
            }));
            
            const requestData = {
                contentType: 'Text',
                configuration: {
                    lang: 'he_IL'
                },
                strokes: convertedStrokes
            };
            
            const message = JSON.stringify(requestData);
            const signature = await this.generateHMAC(CONFIG.MYSCRIPT_HMAC_KEY, message);
            
            const response = await fetch('https://cloud.myscript.com/api/v4.0/iink/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'applicationKey': CONFIG.MYSCRIPT_APP_KEY,
                    'hmac': signature
                },
                body: message
            });
            
            if (!response.ok) {
                const error = await response.json();
                console.error('MyScript error:', error);
                notifier.error('שגיאה בזיהוי');
                return;
            }
            
            const data = await response.json();
            console.log('MyScript response:', data);
            
            if (data.label) {
                const text = data.label;
                
                // Extract first Hebrew character
                const HEBREW_RANGE = /[\u0590-\u05FF]/;
                const match = text.match(HEBREW_RANGE);
                
                if (match) {
                    document.getElementById('test-result-text').textContent = match[0];
                    document.getElementById('test-result').classList.remove('hidden');
                    notifier.success(`זוהה: ${match[0]}`);
                } else {
                    console.log('No Hebrew in recognized text:', text);
                    document.getElementById('test-result-text').textContent = text;
                    document.getElementById('test-result').classList.remove('hidden');
                    notifier.warning(`זוהה: "${text}" (לא עברית)`);
                }
            } else {
                console.log('No label in response');
                notifier.error('לא זוהה טקסט');
            }
        } catch (error) {
            console.error('Recognition error:', error);
            notifier.error('שגיאה בזיהוי');
        }
    }

    setupDraggableGrid() {
        const overlay = document.getElementById('grid-overlay-draggable');
        const container = document.getElementById('grid-preview-container');
        
        let isDragging = false;
        let isResizing = false;
        let currentHandle = null;
        let startX, startY, startRight, startTop, startWidth, startHeight;

        // Dragging the overlay
        overlay.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) return;
            
            isDragging = true;
            const rect = overlay.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            startX = e.clientX;
            startY = e.clientY;
            startRight = containerRect.right - rect.right;
            startTop = rect.top - containerRect.top;
            
            e.preventDefault();
        });

        // Resizing handles
        overlay.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                currentHandle = handle.classList[1]; // top-left, top-right, etc.
                
                const rect = overlay.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                
                startX = e.clientX;
                startY = e.clientY;
                startWidth = rect.width;
                startHeight = rect.height;
                startRight = containerRect.right - rect.right;
                startTop = rect.top - containerRect.top;
                
                e.stopPropagation();
                e.preventDefault();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const containerRect = container.getBoundingClientRect();
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                const newRight = startRight - deltaX;
                const newTop = startTop + deltaY;
                
                // Keep within bounds
                const maxRight = containerRect.width - 50;
                const maxTop = containerRect.height - 50;
                
                overlay.style.right = `${Math.max(0, Math.min(newRight, maxRight))}px`;
                overlay.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
            }
            
            if (isResizing) {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newRight = startRight;
                let newTop = startTop;
                
                if (currentHandle.includes('right')) {
                    newWidth = startWidth - deltaX;
                    newRight = startRight - deltaX;
                } else if (currentHandle.includes('left')) {
                    newWidth = startWidth + deltaX;
                }
                
                if (currentHandle.includes('bottom')) {
                    newHeight = startHeight + deltaY;
                } else if (currentHandle.includes('top')) {
                    newHeight = startHeight - deltaY;
                    newTop = startTop + deltaY;
                }
                
                overlay.style.width = `${Math.max(100, newWidth)}px`;
                overlay.style.height = `${Math.max(100, newHeight)}px`;
                
                if (currentHandle.includes('right')) {
                    overlay.style.right = `${Math.max(0, newRight)}px`;
                }
                if (currentHandle.includes('top')) {
                    overlay.style.top = `${Math.max(0, newTop)}px`;
                }
                
                this.updateGridPreview();
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            isResizing = false;
            currentHandle = null;
        });
    }

    setupFileUpload() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('crossword-upload');
        const previewContainer = document.getElementById('preview-container');
        const preview = document.getElementById('crossword-preview');
        const removeBtn = document.getElementById('remove-image');
        const submitBtn = document.getElementById('create-room-submit');

        // Click to upload
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragging');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragging');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragging');
            
            const file = e.dataTransfer.files[0];
            if (file) {
                this.handleFileSelect(file);
            }
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleFileSelect(file);
            }
        });

        // Remove image
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectedFile = null;
            fileInput.value = '';
            uploadArea.classList.remove('hidden');
            previewContainer.classList.add('hidden');
            submitBtn.disabled = true;
        });
    }

    async handleFileSelect(file) {
        const validation = this.validateFile(file);
        
        if (!validation.valid) {
            notifier.error(validation.error);
            return;
        }

        try {
            // Store the actual file (not base64) for Firebase upload
            this.selectedFile = file;
            
            // Load preview
            const imageData = await this.loadImage(file);
            
            const preview = document.getElementById('crossword-preview');
            preview.src = imageData;
            
            document.getElementById('upload-area').classList.add('hidden');
            document.getElementById('preview-container').classList.remove('hidden');
            
            // Wait for image to load
            await new Promise((resolve) => {
                if (preview.complete) {
                    resolve();
                } else {
                    preview.onload = resolve;
                }
            });
            
            // Show detection status
            const detectionStatus = document.getElementById('detection-status');
            detectionStatus.classList.remove('hidden');
            detectionStatus.querySelector('.status-text').textContent = 'מזהה רשת...';
            
            // Run grid detection
            const result = await gridDetector.detectGrid(preview);
            
            if (result.success) {
                // Store detected grid data
                this.detectedGridData = result.gridData;
                this.detectedGridSettings = result.gridSettings;
                
                // Count black cells
                let blackCount = 0;
                for (let row of result.gridData) {
                    for (let cell of row) {
                        if (cell.isBlack) blackCount++;
                    }
                }
                
                // Show success
                detectionStatus.querySelector('.status-icon').textContent = '✅';
                detectionStatus.querySelector('.status-text').textContent = 'הרשת זוהתה!';
                
                setTimeout(() => {
                    detectionStatus.classList.add('hidden');
                    
                    // Show manual edit mode
                    this.showManualEditMode(preview, result.gridData);
                }, 1500);
                
                notifier.success(`זוהו ${blackCount} תאים חסומים - תוכל לערוך ידנית`);
            } else {
                // Show error
                detectionStatus.querySelector('.status-icon').textContent = '❌';
                detectionStatus.querySelector('.status-text').textContent = 'הזיהוי נכשל';
                
                setTimeout(() => {
                    detectionStatus.classList.add('hidden');
                }, 2000);
                
                notifier.error(result.error);
                document.getElementById('create-room-submit').disabled = true;
            }
            
        } catch (error) {
            console.error('File handling error:', error);
            notifier.error('העלאת התמונה נכשלה. נסה שוב.');
        }
    }

    countPlayableCells(gridData) {
        let count = 0;
        for (let row of gridData) {
            for (let cell of row) {
                if (!cell.isBlack) count++;
            }
        }
        return count;
    }

    validateFile(file) {
        if (!file) {
            return { valid: false, error: 'לא נבחר קובץ' };
        }

        if (file.size > CONFIG.MAX_FILE_SIZE) {
            return { valid: false, error: 'הקובץ גדול מדי (מקסימום 5MB)' };
        }

        if (!CONFIG.ALLOWED_TYPES.includes(file.type)) {
            return { valid: false, error: 'רק תמונות PNG או JPG מותרות' };
        }

        return { valid: true };
    }

    loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                const img = new Image();
                
                img.onload = () => {
                    resolve(e.target.result);
                };
                
                img.onerror = () => {
                    reject(new Error('CORRUPTED_IMAGE'));
                };
                
                img.src = e.target.result;
            };
            
            reader.onerror = () => {
                reject(new Error('FILE_READ_ERROR'));
            };
            
            reader.readAsDataURL(file);
        });
    }

    async createRoom() {
        if (!this.selectedFile) {
            notifier.error('העלה תמונת תשבץ קודם');
            return;
        }

        if (!this.detectedGridData || !this.detectedGridSettings) {
            notifier.error('הרשת לא זוהתה. נסה תמונה אחרת.');
            return;
        }

        const roomName = document.getElementById('room-name-input').value.trim();

        const submitBtn = document.getElementById('create-room-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'יוצר חדר ומעלה תמונה...';

        const result = await roomManager.createRoom(
            this.selectedFile, 
            this.detectedGridData,
            this.detectedGridSettings,
            roomName
        );

        submitBtn.disabled = false;
        submitBtn.textContent = 'צור חדר ותתחיל לפתור';

        if (result.success) {
            // Save to history
            await roomManager.saveToHistory(result.roomId, roomName, result.room.crosswordImageUrl);
            
            notifier.success('החדר נוצר בהצלחה!');
            
            // Clear room name input
            document.getElementById('room-name-input').value = '';
            
            this.enterRoom(result.roomId, result.room);
        } else {
            notifier.error(result.error);
        }
    }

    showManualEditMode(imageElement, gridData) {
        const overlay = document.getElementById('grid-edit-overlay');
        const controls = document.getElementById('edit-controls');
        const previewContainer = document.getElementById('preview-container');
        
        // Get image dimensions
        const imgRect = imageElement.getBoundingClientRect();
        const containerRect = previewContainer.getBoundingClientRect();
        
        // Use the detected grid position (same as how grid is positioned in room)
        const pos = this.detectedGridSettings.position;
        const gridRight = (imgRect.width * pos.right / 100);
        const gridTop = (imgRect.height * pos.top / 100);
        const gridWidth = (imgRect.width * pos.width / 100);
        const gridHeight = (imgRect.height * pos.height / 100);
        
        // Position overlay exactly on the grid area
        overlay.style.width = `${gridWidth}px`;
        overlay.style.height = `${gridHeight}px`;
        overlay.style.right = `${gridRight}px`;
        overlay.style.top = `${gridTop}px`;
        overlay.style.left = 'auto';
        
        // Set grid template
        overlay.style.gridTemplateRows = `repeat(11, 1fr)`;
        overlay.style.gridTemplateColumns = `repeat(11, 1fr)`;
        
        // Clear and create cells
        overlay.innerHTML = '';
        
        for (let row = 0; row < 11; row++) {
            for (let col = 0; col < 11; col++) {
                const cell = document.createElement('div');
                cell.className = `edit-cell ${gridData[row][col].isBlack ? 'black' : 'white'}`;
                cell.dataset.row = row;
                cell.dataset.col = col;
                
                cell.addEventListener('click', () => {
                    // Toggle black/white
                    const isCurrentlyBlack = cell.classList.contains('black');
                    
                    if (isCurrentlyBlack) {
                        cell.classList.remove('black');
                        cell.classList.add('white');
                        this.detectedGridData[row][col].isBlack = false;
                    } else {
                        cell.classList.remove('white');
                        cell.classList.add('black');
                        this.detectedGridData[row][col].isBlack = true;
                    }
                });
                
                overlay.appendChild(cell);
            }
        }
        
        overlay.classList.remove('hidden');
        controls.classList.remove('hidden');
        
        // Confirm button
        document.getElementById('confirm-grid').onclick = () => {
            overlay.classList.add('hidden');
            controls.classList.add('hidden');
            document.getElementById('create-room-submit').disabled = false;
            
            // Count final black cells
            let blackCount = 0;
            for (let row of this.detectedGridData) {
                for (let cell of row) {
                    if (cell.isBlack) blackCount++;
                }
            }
            
            notifier.success(`מוכן! ${blackCount} תאים חסומים`);
        };
    }

    async joinRoom() {
        const input = document.getElementById('room-code-input');
        const roomId = input.value;

        if (!roomId) {
            notifier.error('הזן קוד חדר');
            return;
        }

        const submitBtn = document.getElementById('join-room-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'מצטרף...';

        const result = await roomManager.joinRoom(roomId);

        submitBtn.disabled = false;
        submitBtn.textContent = 'הצטרף לחדר';

        if (result.success) {
            notifier.success('הצטרפת לחדר!');
            input.value = '';
            this.enterRoom(result.room.id, result.room);
        } else {
            notifier.error(result.error);
        }
    }

    async enterRoom(roomId, room) {
        // Show room screen
        this.showScreen('room-screen');

        // Display room ID
        document.getElementById('room-id-display').textContent = roomId;
        document.getElementById('participants-count').textContent = room.participants;

        // Display crossword image from Firebase Storage
        const crosswordImage = document.getElementById('crossword-image');
        crosswordImage.src = room.crosswordImageUrl;

        // Initialize grid with positioning
        await this.crosswordGrid.initialize(roomId, room.grid, room.gridSettings);
        
        // Initialize KNN classifier for handwriting
        if (!window.hebrewKNN && typeof HebrewKNNClassifier !== 'undefined') {
            window.hebrewKNN = new HebrewKNNClassifier();
            await window.hebrewKNN.initialize();
            await window.hebrewKNN.loadModel();
            console.log('✅ KNN classifier loaded for handwriting');
        }
        
        // Setup PC keyboard if not mobile
        if (!this.crosswordGrid.isMobile()) {
            this.crosswordGrid.setupPCKeyboard(roomId);
        }
        
        // Initialize continuous handwriting recognition
        if (!this.continuousHandwriting) {
            this.continuousHandwriting = new ContinuousHandwritingRecognition(
                'handwriting-canvas',
                document.getElementById('crossword-grid')
            );
        }
        this.continuousHandwriting.initialize(roomId);
        
        // Setup toggle button
        const toggleBtn = document.getElementById('toggle-handwriting');
        const isEnabled = this.continuousHandwriting.enabled;
        toggleBtn.classList.toggle('active', isEnabled);
        
        toggleBtn.onclick = () => {
            if (this.continuousHandwriting.enabled) {
                this.continuousHandwriting.disable();
                toggleBtn.classList.remove('active');
                notifier.success('מקלדת פעילה ⌨️');
            } else {
                this.continuousHandwriting.enable();
                toggleBtn.classList.add('active');
                notifier.success('כתב יד פעיל 🖊️');
            }
        };

        // Listen for real-time updates
        this.startRoomSync(roomId);
    }

    startRoomSync(roomId) {
        // Listen to Firebase real-time updates
        roomManager.listenToRoom(roomId, (room) => {
            if (!room) return;

            // Update participant count
            document.getElementById('participants-count').textContent = room.participants;
            
            // Update grid cells
            if (room.grid) {
                for (let row = 0; row < room.grid.length; row++) {
                    for (let col = 0; col < room.grid[row].length; col++) {
                        const cellData = room.grid[row][col];
                        this.crosswordGrid.updateCellDisplay(row, col, cellData.letter);
                    }
                }
            }
        });
    }

    async leaveRoom() {
        const roomId = document.getElementById('room-id-display').textContent;
        await roomManager.leaveRoom(roomId);

        this.keyboard.hide();
        this.showScreen('home-screen');
        notifier.success('עזבת את החדר');
    }

    showKeyboard(roomId, row, col) {
        // Only show custom keyboard on mobile
        if (this.crosswordGrid.isMobile()) {
            this.keyboard.show(roomId, row, col);
        }
    }

    hideKeyboard() {
        this.keyboard.hide();
    }

    async saveSettings() {
        const rows = parseInt(document.getElementById('grid-rows').value);
        const cols = parseInt(document.getElementById('grid-cols').value);

        if (rows < 5 || rows > 25 || cols < 5 || cols > 25) {
            notifier.error('גודל רשת לא חוקי (5-25)');
            return;
        }

        // Get overlay position in pixels
        const overlay = document.getElementById('grid-overlay-draggable');
        const container = document.getElementById('grid-preview-container');
        
        if (!overlay.classList.contains('visible')) {
            notifier.error('העלה תמונת תשבץ קודם');
            return;
        }
        
        const containerRect = container.getBoundingClientRect();
        const overlayStyles = window.getComputedStyle(overlay);
        
        const rightPx = parseFloat(overlayStyles.right);
        const topPx = parseFloat(overlayStyles.top);
        const widthPx = parseFloat(overlayStyles.width);
        const heightPx = parseFloat(overlayStyles.height);
        
        // Convert to percentages
        const right = (rightPx / containerRect.width) * 100;
        const top = (topPx / containerRect.height) * 100;
        const width = (widthPx / containerRect.width) * 100;
        const height = (heightPx / containerRect.height) * 100;

        const gridSettings = {
            rows,
            cols,
            position: { 
                right: Math.round(right * 100) / 100, 
                top: Math.round(top * 100) / 100, 
                width: Math.round(width * 100) / 100, 
                height: Math.round(height * 100) / 100 
            }
        };

        await storageManager.saveData('grid_settings', gridSettings);

        // Save Azure settings
        const handwritingEnabled = document.getElementById('enable-handwriting').checked;
        if (handwritingEnabled) {
            const endpoint = document.getElementById('azure-endpoint').value.trim();
            const key = document.getElementById('azure-key').value.trim();

            if (endpoint && key) {
                CONFIG.AZURE_ENDPOINT = endpoint;
                CONFIG.AZURE_KEY = key;
                CONFIG.HANDWRITING_ENABLED = true;

                await storageManager.saveData('azure_config', {
                    endpoint,
                    key,
                    enabled: true
                });

                notifier.success('ההגדרות נשמרו! זיהוי כתב יד מופעל ✍️');
            } else {
                notifier.warning('הגדרות רשת נשמרו, אבל זיהוי כתב יד דורש Endpoint ו-Key');
            }
        } else {
            CONFIG.HANDWRITING_ENABLED = false;
            await storageManager.saveData('azure_config', { enabled: false });
            notifier.success('ההגדרות נשמרו בהצלחה!');
        }
        
        setTimeout(() => {
            this.showScreen('home-screen');
        }, 1500);
    }

    async resetGrid() {
        const defaultSettings = {
            rows: 15,
            cols: 15,
            position: { right: 10, top: 10, width: 80, height: 80 }
        };
        
        await storageManager.saveData('grid_settings', defaultSettings);
        
        document.getElementById('grid-rows').value = 15;
        document.getElementById('grid-cols').value = 15;
        
        // Reset overlay position
        const overlay = document.getElementById('grid-overlay-draggable');
        const container = document.getElementById('grid-preview-container');
        const containerRect = container.getBoundingClientRect();
        
        overlay.style.right = `${containerRect.width * 0.1}px`;
        overlay.style.top = `${containerRect.height * 0.1}px`;
        overlay.style.width = `${containerRect.width * 0.8}px`;
        overlay.style.height = `${containerRect.height * 0.8}px`;
        
        this.updateGridPreview();
        notifier.success('הרשת אופסה לברירת מחדל');
    }

    async copyRoomId() {
        const roomId = document.getElementById('room-id-display').textContent;
        
        try {
            await navigator.clipboard.writeText(roomId);
            notifier.success('הקוד הועתק ללוח!');
        } catch (error) {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = roomId;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            notifier.success('הקוד הועתק ללוח!');
        }
    }

    showScreen(screenId) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;

            // Load settings when showing settings screen
            if (screenId === 'settings-screen') {
                this.loadSettingsScreen();
            }
        }
    }

    async showHistoryScreen() {
        this.showScreen('history-screen');
        await this.renderHistory();
    }

    async renderHistory() {
        const historyList = document.getElementById('history-list');
        const history = await roomManager.getHistory();

        if (history.length === 0) {
            historyList.innerHTML = `
                <div class="empty-history">
                    <div class="empty-icon">📭</div>
                    <p>אין תשבצים קודמים</p>
                    <p class="empty-hint">תשבצים שתיצור יופיעו כאן</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = history.map(item => {
            const date = new Date(item.lastAccessed);
            const dateStr = date.toLocaleDateString('he-IL');
            const timeStr = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

            return `
                <div class="history-item" data-room-id="${item.roomId}">
                    <div class="history-item-icon">📝</div>
                    <div class="history-item-info">
                        <div class="history-item-name">${item.name}</div>
                        <div class="history-item-meta">
                            <span>קוד: ${item.roomId}</span>
                            <span>📅 ${dateStr}</span>
                            <span>🕐 ${timeStr}</span>
                        </div>
                    </div>
                    <div class="history-item-actions">
                        <button class="history-delete-btn" data-room-id="${item.roomId}" onclick="event.stopPropagation()">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers
        document.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('history-delete-btn')) return;
                
                const roomId = item.dataset.roomId;
                await this.joinRoomFromHistory(roomId);
            });
        });

        document.querySelectorAll('.history-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const roomId = btn.dataset.roomId;
                await this.deleteHistoryItem(roomId);
            });
        });
    }

    async joinRoomFromHistory(roomId) {
        const result = await roomManager.joinRoom(roomId);

        if (result.success) {
            // Update last accessed time
            const history = await roomManager.getHistory();
            const item = history.find(h => h.roomId === roomId);
            if (item) {
                await roomManager.saveToHistory(roomId, item.name, item.imageUrl);
            }

            notifier.success('חזרת לתשבץ!');
            this.enterRoom(result.room.id, result.room);
        } else {
            notifier.error('החדר לא נמצא או נמחק');
        }
    }

    async deleteHistoryItem(roomId) {
        if (confirm('האם למחוק תשבץ זה מההיסטוריה?')) {
            const result = await roomManager.deleteFromHistory(roomId);
            
            if (result.success) {
                notifier.success('התשבץ נמחק מההיסטוריה');
                await this.renderHistory();
            } else {
                notifier.error('המחיקה נכשלה');
            }
        }
    }

    async loadSettingsScreen() {
        const gridSettings = await storageManager.getData('grid_settings') || {
            rows: 15,
            cols: 15,
            position: { right: 10, top: 10, width: 80, height: 80 }
        };

        document.getElementById('grid-rows').value = gridSettings.rows;
        document.getElementById('grid-cols').value = gridSettings.cols;

        // Load MyScript configuration
        const myScriptConfig = await storageManager.getData('myscript_config');
        if (myScriptConfig) {
            document.getElementById('myscript-app-key').value = myScriptConfig.appKey || '';
            document.getElementById('myscript-hmac-key').value = myScriptConfig.hmacKey || '';
            CONFIG.MYSCRIPT_APP_KEY = myScriptConfig.appKey;
            CONFIG.MYSCRIPT_HMAC_KEY = myScriptConfig.hmacKey;
        }

        // If there's a template image, position the overlay
        const overlay = document.getElementById('grid-overlay-draggable');
        const container = document.getElementById('grid-preview-container');
        
        if (overlay.classList.contains('visible')) {
            const containerRect = container.getBoundingClientRect();
            const pos = gridSettings.position;
            
            overlay.style.right = `${(containerRect.width * pos.right) / 100}px`;
            overlay.style.top = `${(containerRect.height * pos.top) / 100}px`;
            overlay.style.width = `${(containerRect.width * pos.width) / 100}px`;
            overlay.style.height = `${(containerRect.height * pos.height) / 100}px`;
        }

        this.updateGridPreview();
    }

    async loadTemplateImage(file) {
        try {
            const imageData = await this.loadImage(file);
            const imgElement = document.getElementById('grid-preview-image');
            imgElement.src = imageData;
            
            // Show overlay once image loads
            imgElement.onload = () => {
                const overlay = document.getElementById('grid-overlay-draggable');
                const container = document.getElementById('grid-preview-container');
                const imgRect = imgElement.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                
                // Position overlay in center of image initially
                const overlayWidth = imgRect.width * 0.8;
                const overlayHeight = imgRect.height * 0.8;
                const overlayRight = (containerRect.width - overlayWidth) / 2;
                const overlayTop = (containerRect.height - overlayHeight) / 2;
                
                overlay.style.width = `${overlayWidth}px`;
                overlay.style.height = `${overlayHeight}px`;
                overlay.style.right = `${overlayRight}px`;
                overlay.style.top = `${overlayTop}px`;
                overlay.classList.add('visible');
                
                this.updateGridPreview();
            };
            
            notifier.success('התמונה נטענה!');
        } catch (error) {
            notifier.error('טעינת התמונה נכשלה');
        }
    }

    updateGridPreview() {
        const rows = parseInt(document.getElementById('grid-rows').value) || 15;
        const cols = parseInt(document.getElementById('grid-cols').value) || 15;
        const showLines = document.getElementById('show-grid-lines').checked;

        const gridPreview = document.getElementById('grid-preview-overlay');
        
        // Set grid template
        gridPreview.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        gridPreview.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        
        // Toggle grid lines visibility
        if (showLines) {
            gridPreview.classList.add('show-lines');
        } else {
            gridPreview.classList.remove('show-lines');
        }
        
        // Create preview cells
        gridPreview.innerHTML = '';
        for (let i = 0; i < rows * cols; i++) {
            const cell = document.createElement('div');
            cell.className = 'preview-cell';
            gridPreview.appendChild(cell);
        }
    }
}

// ========================
// Initialize Application
// ========================

let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new CrosswordApp();
    console.log('תשבץ משפחתי - האפליקציה הופעלה עם Firebase!');
});
