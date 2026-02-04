// Clue Marking System
// Mark clues as completed with circle and green color

class ClueMarking {
    constructor() {
        this.roomId = null;
        this.markedClues = new Set(); // Set of marked clue numbers
        this.cluesListener = null;
        this.clueDetector = null;
        this.autoDetectEnabled = false;
    }

    initialize(roomId, imageElement, gridBounds, enableAutoDetect = true) {
        this.roomId = roomId;
        this.autoDetectEnabled = enableAutoDetect;
        
        console.log('✅ Clue marking system initialized');
        
        // Setup Firebase sync
        this.setupFirebaseSync();
        
        if (enableAutoDetect && imageElement && gridBounds) {
            // Use automatic detection
            this.initializeAutoDetection(imageElement, gridBounds);
        } else {
            // Fallback to manual UI
            this.createClueUI();
        }
    }

    async initializeAutoDetection(imageElement, gridBounds) {
        console.log('🤖 Initializing automatic clue detection...');
        
        try {
            this.clueDetector = new ClueDetector();
            
            // Show loading indicator
            this.showLoadingIndicator();
            
            // Detect clues
            const detectedClues = await this.clueDetector.detectClues(imageElement, gridBounds);
            
            if (detectedClues && detectedClues.length > 0) {
                // Create clickable hotspots
                const container = document.body; // Or imageElement.parentElement
                this.clueDetector.createClickableHotspots(container, (clueNum) => {
                    this.toggleClue(clueNum);
                });
                
                console.log(`✅ Auto-detection successful: ${detectedClues.length} clues`);
            } else {
                console.warn('⚠️ No clues detected, falling back to manual input');
                this.createClueUI();
            }
            
            this.hideLoadingIndicator();
            
        } catch (error) {
            console.error('❌ Auto-detection failed:', error);
            console.log('📝 Falling back to manual input');
            this.hideLoadingIndicator();
            this.createClueUI();
        }
    }

    showLoadingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'clue-detection-loading';
        indicator.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px 30px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            text-align: center;
        `;
        indicator.innerHTML = `
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px;">🔍 Detecting Clues...</div>
            <div style="font-size: 14px; color: #6b7280;">This may take a moment</div>
        `;
        document.body.appendChild(indicator);
    }

    hideLoadingIndicator() {
        const indicator = document.getElementById('clue-detection-loading');
        if (indicator) indicator.remove();
    }

    createClueUI() {
        // Create floating clue marking panel
        const panel = document.createElement('div');
        panel.id = 'clue-marking-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: white;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            padding: 15px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1000;
            max-width: 200px;
        `;
        
        panel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px; color: #374151;">Mark Clues:</div>
            <input 
                type="number" 
                id="clue-number-input" 
                placeholder="Clue #" 
                style="
                    width: 100%;
                    padding: 8px;
                    border: 2px solid #e5e7eb;
                    border-radius: 8px;
                    font-size: 14px;
                    margin-bottom: 10px;
                "
            />
            <button 
                id="mark-clue-btn"
                style="
                    width: 100%;
                    padding: 8px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-weight: bold;
                    cursor: pointer;
                "
            >Mark Done ✓</button>
            <div id="marked-clues-list" style="margin-top: 15px; font-size: 13px;"></div>
        `;
        
        document.body.appendChild(panel);
        
        // Setup event listeners
        const input = document.getElementById('clue-number-input');
        const btn = document.getElementById('mark-clue-btn');
        
        btn.addEventListener('click', () => {
            const clueNum = input.value.trim();
            if (clueNum) {
                this.toggleClue(clueNum);
                input.value = '';
            }
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                btn.click();
            }
        });
        
        console.log('✅ Clue UI created');
        this.updateClueList();
    }

    updateClueList() {
        const list = document.getElementById('marked-clues-list');
        if (!list) return;
        
        if (this.markedClues.size === 0) {
            list.innerHTML = '<div style="color: #9ca3af;">No clues marked yet</div>';
            return;
        }
        
        const sorted = Array.from(this.markedClues).sort((a, b) => parseInt(a) - parseInt(b));
        
        list.innerHTML = `
            <div style="color: #374151; font-weight: bold; margin-bottom: 5px;">Completed:</div>
            ${sorted.map(num => `
                <div style="
                    display: inline-block;
                    margin: 2px;
                    padding: 4px 8px;
                    background: #22c55e;
                    color: white;
                    border-radius: 12px;
                    font-size: 12px;
                    cursor: pointer;
                " onclick="window.clueMarkingInstance.toggleClue('${num}')">${num}</div>
            `).join('')}
        `;
    }

    scanForClues() {
        // Not needed anymore - using manual input
        console.log('ℹ️ Using manual clue input (clues are in image)');
    }

    isBlueish(colorStr) {
        // Parse RGB values
        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!match) return false;
        
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        
        // Blue if B is significantly higher than R and G
        return b > 100 && b > r + 50 && b > g + 50;
    }

    toggleClue(clueNum) {
        if (this.markedClues.has(clueNum)) {
            // Unmark
            this.markedClues.delete(clueNum);
            console.log(`⭕ Unmarked clue ${clueNum}`);
        } else {
            // Mark
            this.markedClues.add(clueNum);
            console.log(`✅ Marked clue ${clueNum}`);
        }
        
        // Update UI
        this.updateClueList();
        
        // Sync to Firebase
        this.syncToFirebase();
    }

    updateClueAppearance(clueNum, marked) {
        // Not needed for manual input approach
    }

    syncToFirebase() {
        if (!this.roomId) return;
        
        const db = window.database || firebase.database();
        const cluesRef = db.ref(`rooms/${this.roomId}/markedClues`);
        
        const cluesArray = Array.from(this.markedClues);
        
        if (cluesArray.length === 0) {
            cluesRef.set(null);
        } else {
            cluesRef.set(cluesArray);
        }
    }

    setupFirebaseSync() {
        if (!this.roomId) return;
        
        // Make instance globally accessible for onclick handlers
        window.clueMarkingInstance = this;
        
        const db = window.database || firebase.database();
        const cluesRef = db.ref(`rooms/${this.roomId}/markedClues`);
        
        this.cluesListener = cluesRef.on('value', (snapshot) => {
            const data = snapshot.val();
            
            if (!data) {
                this.markedClues.clear();
            } else {
                this.markedClues = new Set(data);
            }
            
            // Update UI (either manual list or hotspots)
            if (this.clueDetector) {
                this.clueDetector.updateAllHotspots(this.markedClues);
            } else {
                this.updateClueList();
            }
            
            console.log(`📥 Synced ${this.markedClues.size} marked clues`);
        });
    }

    destroy() {
        if (this.cluesListener) {
            const db = window.database || firebase.database();
            db.ref(`rooms/${this.roomId}/markedClues`).off('value', this.cluesListener);
        }
    }
}

window.ClueMarking = ClueMarking;
