// Clue Marking System
// Mark clues as completed with circle and green color

class ClueMarking {
    constructor() {
        this.roomId = null;
        this.markedClues = new Set(); // Set of marked clue numbers
        this.clueElements = new Map(); // Map clue number to DOM element
        this.cluesListener = null;
    }

    initialize(roomId) {
        this.roomId = roomId;
        console.log('✅ Clue marking system initialized');
        
        // Setup Firebase sync
        this.setupFirebaseSync();
        
        // Scan for clue numbers in the page
        this.scanForClues();
    }

    scanForClues() {
        // Look for elements with blue text (clue numbers)
        const allElements = document.querySelectorAll('*');
        
        for (const el of allElements) {
            const style = window.getComputedStyle(el);
            const color = style.color;
            
            // Check if element has blue color (RGB values for blue)
            if (color.includes('rgb') && this.isBlueish(color)) {
                const text = el.textContent.trim();
                
                // Check if it's a number (clue number)
                if (/^\d+$/.test(text)) {
                    const clueNum = text;
                    this.clueElements.set(clueNum, el);
                    
                    // Make clickable
                    el.style.cursor = 'pointer';
                    el.style.transition = 'all 0.3s ease';
                    
                    // Add click handler
                    el.addEventListener('click', () => this.toggleClue(clueNum));
                    
                    console.log(`📍 Found clue: ${clueNum}`);
                }
            }
        }
        
        console.log(`✅ Found ${this.clueElements.size} clue numbers`);
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
            this.updateClueAppearance(clueNum, false);
        } else {
            // Mark
            this.markedClues.add(clueNum);
            this.updateClueAppearance(clueNum, true);
        }
        
        // Sync to Firebase
        this.syncToFirebase();
        
        console.log(`${this.markedClues.has(clueNum) ? '✅' : '⭕'} Clue ${clueNum}`);
    }

    updateClueAppearance(clueNum, marked) {
        const el = this.clueElements.get(clueNum);
        if (!el) return;
        
        if (marked) {
            // Green color + circle
            el.style.color = '#22c55e'; // Green
            el.style.backgroundColor = 'transparent';
            el.style.border = '2px solid #22c55e';
            el.style.borderRadius = '50%';
            el.style.padding = '2px 6px';
            el.style.display = 'inline-block';
            el.style.minWidth = '24px';
            el.style.textAlign = 'center';
        } else {
            // Back to original blue
            el.style.color = ''; // Reset to original
            el.style.backgroundColor = '';
            el.style.border = '';
            el.style.borderRadius = '';
            el.style.padding = '';
            el.style.display = '';
            el.style.minWidth = '';
            el.style.textAlign = '';
        }
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
        
        const db = window.database || firebase.database();
        const cluesRef = db.ref(`rooms/${this.roomId}/markedClues`);
        
        this.cluesListener = cluesRef.on('value', (snapshot) => {
            const data = snapshot.val();
            
            if (!data) {
                // Clear all marks
                for (const clueNum of this.markedClues) {
                    this.updateClueAppearance(clueNum, false);
                }
                this.markedClues.clear();
                return;
            }
            
            // Update marked clues
            const newMarked = new Set(data);
            
            // Unmark clues that were removed
            for (const clueNum of this.markedClues) {
                if (!newMarked.has(clueNum)) {
                    this.updateClueAppearance(clueNum, false);
                }
            }
            
            // Mark new clues
            for (const clueNum of newMarked) {
                if (!this.markedClues.has(clueNum)) {
                    this.updateClueAppearance(clueNum, true);
                }
            }
            
            this.markedClues = newMarked;
            
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
