// ========================
// Configuration & Constants
// ========================

const CONFIG = {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_TYPES: ['image/png', 'image/jpeg', 'image/jpg'],
    ROOM_ID_LENGTH: 6,
    STORAGE_KEY_PREFIX: 'crossword_',
    SYNC_INTERVAL: 2000, // 2 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
};

const HEBREW_RANGE = /^[\u0590-\u05FF]$/;

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
// Storage Manager
// ========================

class StorageManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.setupConnectionHandlers();
    }

    setupConnectionHandlers() {
        window.addEventListener('online', () => this.handleReconnect());
        window.addEventListener('offline', () => this.handleDisconnect());
    }

    handleDisconnect() {
        this.isOnline = false;
        const banner = document.getElementById('connection-status');
        banner.classList.remove('hidden');
        notifier.warning('אין חיבור לאינטרנט - השינויים יישמרו כשהחיבור יחזור');
    }

    async handleReconnect() {
        this.isOnline = true;
        const banner = document.getElementById('connection-status');
        banner.classList.add('hidden');
        notifier.success('החיבור חזר! משתף עדכונים...');
        
        // Sync queued updates
        while (this.syncQueue.length > 0) {
            const update = this.syncQueue.shift();
            await this.saveData(update.key, update.data);
        }
    }

    async saveData(key, data) {
        const fullKey = CONFIG.STORAGE_KEY_PREFIX + key;
        
        try {
            if (this.isOnline) {
                // Save to localStorage (simulating GitHub Pages storage)
                localStorage.setItem(fullKey, JSON.stringify({
                    data,
                    timestamp: Date.now()
                }));
                return { success: true };
            } else {
                // Queue for later
                this.syncQueue.push({ key, data });
                return { success: true, queued: true };
            }
        } catch (error) {
            console.error('Storage error:', error);
            return { success: false, error: 'שגיאת שמירה' };
        }
    }

    async getData(key) {
        const fullKey = CONFIG.STORAGE_KEY_PREFIX + key;
        
        try {
            const stored = localStorage.getItem(fullKey);
            if (!stored) return null;
            
            const parsed = JSON.parse(stored);
            return parsed.data;
        } catch (error) {
            console.error('Storage retrieval error:', error);
            return null;
        }
    }

    async deleteData(key) {
        const fullKey = CONFIG.STORAGE_KEY_PREFIX + key;
        
        try {
            localStorage.removeItem(fullKey);
            return { success: true };
        } catch (error) {
            console.error('Storage deletion error:', error);
            return { success: false };
        }
    }

    getAllRooms() {
        const rooms = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(CONFIG.STORAGE_KEY_PREFIX + 'room_')) {
                const roomId = key.replace(CONFIG.STORAGE_KEY_PREFIX + 'room_', '');
                rooms.push(roomId);
            }
        }
        return rooms;
    }
}

const storage = new StorageManager();

// ========================
// Room Manager
// ========================

class RoomManager {
    constructor() {
        this.currentRoom = null;
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
        const room = await storage.getData(`room_${roomId}`);
        return room !== null;
    }

    async createRoom(crosswordImageData) {
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

            const gridSettings = await storage.getData('grid_settings') || {
                rows: 15,
                cols: 15,
                position: { right: 10, top: 10, width: 80, height: 80 }
            };

            const room = {
                id: roomId,
                crosswordImage: crosswordImageData,
                grid: this.initializeGrid(gridSettings.rows, gridSettings.cols),
                gridSettings: gridSettings,
                participants: 1,
                createdAt: Date.now()
            };

            const result = await storage.saveData(`room_${roomId}`, room);
            
            if (!result.success) {
                throw new Error('SAVE_FAILED');
            }

            this.currentRoom = room;
            return { success: true, roomId, room };
            
        } catch (error) {
            console.error('Room creation error:', error);
            return {
                success: false,
                error: 'לא הצלחנו ליצור חדר. נסה שוב.'
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

            const room = await storage.getData(`room_${roomId}`);
            
            if (!room) {
                throw new Error('ROOM_NOT_FOUND');
            }

            // Increment participants
            room.participants++;
            await storage.saveData(`room_${roomId}`, room);

            this.currentRoom = room;
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
            const room = await storage.getData(`room_${roomId}`);
            if (!room) throw new Error('ROOM_NOT_FOUND');

            room.grid[row][col].letter = letter;
            room.grid[row][col].timestamp = Date.now();

            await storage.saveData(`room_${roomId}`, room);
            this.currentRoom = room;
            
            return { success: true };
        } catch (error) {
            console.error('Cell update error:', error);
            return { success: false };
        }
    }

    async leaveRoom(roomId) {
        try {
            const room = await storage.getData(`room_${roomId}`);
            if (room) {
                room.participants = Math.max(0, room.participants - 1);
                await storage.saveData(`room_${roomId}`, room);
            }
        } catch (error) {
            console.error('Leave room error:', error);
        }
    }
}

const roomManager = new RoomManager();

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
    }

    async initialize(roomId, gridData, gridSettings) {
        this.grid = gridData;
        this.rows = gridData.length;
        this.cols = gridData[0].length;

        // Apply grid positioning from settings
        if (gridSettings && gridSettings.position) {
            const pos = gridSettings.position;
            this.container.style.right = `${pos.right}%`;
            this.container.style.top = `${pos.top}%`;
            this.container.style.width = `${pos.width}%`;
            this.container.style.height = `${pos.height}%`;
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
            cell.classList.add('black-cell');
        } else {
            cell.textContent = cellData.letter;
            if (cellData.letter) {
                cell.classList.add('has-letter');
            }

            cell.addEventListener('click', () => {
                this.selectCell(roomId, row, col);
            });
        }

        return cell;
    }

    selectCell(roomId, row, col) {
        // Remove previous active state
        if (this.activeCell) {
            this.activeCell.classList.remove('active');
        }

        // Set new active cell
        const cell = this.container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (cell && !cell.classList.contains('black-cell')) {
            cell.classList.add('active');
            this.activeCell = cell;

            // Show keyboard
            app.showKeyboard(roomId, row, col);
        }
    }

    async updateCell(roomId, row, col, letter) {
        const cell = this.container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) return;

        // Optimistic update
        cell.textContent = letter;
        cell.classList.toggle('has-letter', letter !== '');
        cell.classList.add('pending');

        // Sync to storage
        const result = await roomManager.updateCell(roomId, row, col, letter);
        
        cell.classList.remove('pending');
        
        if (!result.success) {
            notifier.error('לא הצלחנו לשמור. מנסים שוב...');
            // Retry logic could go here
        }
    }

    getNextCell(row, col) {
        // Move right
        if (col < this.cols - 1) {
            const nextCell = this.grid[row][col + 1];
            if (!nextCell.isBlack) {
                return { row, col: col + 1 };
            }
        }

        // Move to next row
        if (row < this.rows - 1) {
            for (let newCol = 0; newCol < this.cols; newCol++) {
                if (!this.grid[row + 1][newCol].isBlack) {
                    return { row: row + 1, col: newCol };
                }
            }
        }

        return null;
    }

    getPreviousCell(row, col) {
        // Move left
        if (col > 0) {
            const prevCell = this.grid[row][col - 1];
            if (!prevCell.isBlack) {
                return { row, col: col - 1 };
            }
        }

        // Move to previous row
        if (row > 0) {
            for (let newCol = this.cols - 1; newCol >= 0; newCol--) {
                if (!this.grid[row - 1][newCol].isBlack) {
                    return { row: row - 1, col: newCol };
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
        this.setupEventListeners();
        this.showScreen('home-screen');
    }

    setupEventListeners() {
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
            // Load and preview image
            const imageData = await this.loadImage(file);
            
            this.selectedFile = imageData;
            
            const preview = document.getElementById('crossword-preview');
            preview.src = imageData;
            
            document.getElementById('upload-area').classList.add('hidden');
            document.getElementById('preview-container').classList.remove('hidden');
            document.getElementById('create-room-submit').disabled = false;
            
        } catch (error) {
            notifier.error('העלאת התמונה נכשלה. נסה שוב.');
        }
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

        const submitBtn = document.getElementById('create-room-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'יוצר חדר...';

        const result = await roomManager.createRoom(this.selectedFile);

        submitBtn.disabled = false;
        submitBtn.textContent = 'צור חדר ותתחיל לפתור';

        if (result.success) {
            notifier.success('החדר נוצר בהצלחה!');
            this.enterRoom(result.roomId, result.room);
        } else {
            notifier.error(result.error);
        }
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

        // Display crossword image
        const crosswordImage = document.getElementById('crossword-image');
        crosswordImage.src = room.crosswordImage;

        // Initialize grid with positioning
        await this.crosswordGrid.initialize(roomId, room.grid, room.gridSettings);

        // Start sync interval
        this.startRoomSync(roomId);
    }

    startRoomSync(roomId) {
        // Poll for updates every 2 seconds
        this.syncInterval = setInterval(async () => {
            const room = await storage.getData(`room_${roomId}`);
            if (room) {
                // Update participant count
                document.getElementById('participants-count').textContent = room.participants;
                
                // Update grid cells that changed
                await this.crosswordGrid.initialize(roomId, room.grid, room.gridSettings);
            }
        }, CONFIG.SYNC_INTERVAL);
    }

    async leaveRoom() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        const roomId = document.getElementById('room-id-display').textContent;
        await roomManager.leaveRoom(roomId);

        this.keyboard.hide();
        this.showScreen('home-screen');
        notifier.success('עזבת את החדר');
    }

    showKeyboard(roomId, row, col) {
        this.keyboard.show(roomId, row, col);
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

        await storage.saveData('grid_settings', gridSettings);
        notifier.success('ההגדרות נשמרו בהצלחה!');
        
        setTimeout(() => {
            this.showScreen('home-screen');
        }, 1000);
    }

    async resetGrid() {
        const defaultSettings = {
            rows: 15,
            cols: 15,
            position: { right: 10, top: 10, width: 80, height: 80 }
        };
        
        await storage.saveData('grid_settings', defaultSettings);
        
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

    async loadSettingsScreen() {
        const gridSettings = await storage.getData('grid_settings') || {
            rows: 15,
            cols: 15,
            position: { right: 10, top: 10, width: 80, height: 80 }
        };

        document.getElementById('grid-rows').value = gridSettings.rows;
        document.getElementById('grid-cols').value = gridSettings.cols;

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
}

// ========================
// Initialize Application
// ========================

let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new CrosswordApp();
    console.log('תשבץ משפחתי - האפליקציה הופעלה!');
});
