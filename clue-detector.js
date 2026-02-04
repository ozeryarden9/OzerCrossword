// Automatic Clue Detection System
// Uses OpenCV.js and Tesseract.js to find and recognize clue numbers

class ClueDetector {
    constructor() {
        this.detectedClues = []; // [{number, x, y, width, height}, ...]
        this.isProcessing = false;
    }

    async detectClues(imageElement, gridBounds) {
        if (this.isProcessing) {
            console.warn('⚠️ Already processing');
            return;
        }

        this.isProcessing = true;
        console.log('🔍 Starting automatic clue detection...');

        try {
            // Wait for OpenCV to be ready
            await this.waitForOpenCV();

            // Convert image to OpenCV format
            const src = cv.imread(imageElement);
            const gray = new cv.Mat();
            const binary = new cv.Mat();
            
            // Convert to grayscale
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            
            // Apply adaptive threshold to detect text
            cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
            
            console.log('📊 Image preprocessed');

            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            console.log(`📦 Found ${contours.size()} contours`);

            // Filter contours outside grid area
            const candidates = [];
            const imageRect = imageElement.getBoundingClientRect();
            
            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const rect = cv.boundingRect(contour);
                
                // Convert rect to screen coordinates
                const x = (rect.x / src.cols) * imageRect.width + imageRect.left;
                const y = (rect.y / src.rows) * imageRect.height + imageRect.top;
                const w = (rect.width / src.cols) * imageRect.width;
                const h = (rect.height / src.rows) * imageRect.height;
                
                // Check if outside grid bounds
                const isOutsideGrid = 
                    x + w < gridBounds.left ||
                    x > gridBounds.right ||
                    y + h < gridBounds.top ||
                    y > gridBounds.bottom;
                
                // Check size is reasonable for a clue number (not too big or small)
                const isReasonableSize = w >= 15 && w <= 60 && h >= 15 && h <= 60;
                
                if (isOutsideGrid && isReasonableSize) {
                    // Extract this region for OCR
                    const roi = src.roi(rect);
                    candidates.push({
                        rect: {x, y, w, h},
                        imageRect: rect,
                        roi: roi
                    });
                }
            }
            
            console.log(`🎯 Found ${candidates.length} candidate regions outside grid`);

            // Run OCR on each candidate
            const worker = await Tesseract.createWorker();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');
            await worker.setParameters({
                tessedit_char_whitelist: '0123456789', // Only recognize numbers
            });

            for (const candidate of candidates) {
                try {
                    // Convert OpenCV Mat to canvas for Tesseract
                    const canvas = document.createElement('canvas');
                    canvas.width = candidate.imageRect.width;
                    canvas.height = candidate.imageRect.height;
                    cv.imshow(canvas, candidate.roi);
                    
                    // Run OCR
                    const { data: { text } } = await worker.recognize(canvas);
                    const number = text.trim();
                    
                    // If we got a valid number, save it
                    if (/^\d+$/.test(number)) {
                        this.detectedClues.push({
                            number: number,
                            x: candidate.rect.x,
                            y: candidate.rect.y,
                            width: candidate.rect.w,
                            height: candidate.rect.h
                        });
                        console.log(`✅ Detected clue: ${number} at (${candidate.rect.x.toFixed(0)}, ${candidate.rect.y.toFixed(0)})`);
                    }
                    
                    // Clean up ROI
                    candidate.roi.delete();
                } catch (err) {
                    console.warn('⚠️ OCR failed for candidate:', err);
                }
            }

            await worker.terminate();

            // Clean up OpenCV resources
            src.delete();
            gray.delete();
            binary.delete();
            contours.delete();
            hierarchy.delete();

            console.log(`🎉 Detection complete! Found ${this.detectedClues.length} clue numbers`);
            
            return this.detectedClues;

        } catch (error) {
            console.error('❌ Clue detection error:', error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    async waitForOpenCV() {
        return new Promise((resolve, reject) => {
            if (typeof cv !== 'undefined' && cv.Mat) {
                resolve();
                return;
            }

            let attempts = 0;
            const maxAttempts = 50; // 5 seconds
            
            const checkInterval = setInterval(() => {
                attempts++;
                
                if (typeof cv !== 'undefined' && cv.Mat) {
                    clearInterval(checkInterval);
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    reject(new Error('OpenCV.js failed to load'));
                }
            }, 100);
        });
    }

    createClickableHotspots(containerElement, onClueClick) {
        console.log('🎯 Creating clickable hotspots for detected clues...');

        for (const clue of this.detectedClues) {
            const hotspot = document.createElement('div');
            hotspot.className = 'clue-hotspot';
            hotspot.dataset.clueNumber = clue.number;
            
            hotspot.style.cssText = `
                position: absolute;
                left: ${clue.x}px;
                top: ${clue.y}px;
                width: ${clue.width}px;
                height: ${clue.height}px;
                cursor: pointer;
                border: 2px solid transparent;
                border-radius: 50%;
                transition: all 0.3s ease;
                z-index: 10;
            `;
            
            // Visual feedback on hover
            hotspot.addEventListener('mouseenter', () => {
                hotspot.style.border = '2px solid #3b82f6';
                hotspot.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            });
            
            hotspot.addEventListener('mouseleave', () => {
                if (!hotspot.classList.contains('marked')) {
                    hotspot.style.border = '2px solid transparent';
                    hotspot.style.backgroundColor = 'transparent';
                }
            });
            
            // Click handler
            hotspot.addEventListener('click', () => {
                onClueClick(clue.number);
                this.updateHotspotAppearance(hotspot, true);
            });
            
            containerElement.appendChild(hotspot);
            
            console.log(`📍 Hotspot created for clue ${clue.number}`);
        }

        console.log(`✅ Created ${this.detectedClues.length} hotspots`);
    }

    updateHotspotAppearance(hotspot, marked) {
        if (marked) {
            hotspot.classList.add('marked');
            hotspot.style.border = '2px solid #22c55e';
            hotspot.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
        } else {
            hotspot.classList.remove('marked');
            hotspot.style.border = '2px solid transparent';
            hotspot.style.backgroundColor = 'transparent';
        }
    }

    updateAllHotspots(markedClues) {
        const hotspots = document.querySelectorAll('.clue-hotspot');
        
        for (const hotspot of hotspots) {
            const clueNum = hotspot.dataset.clueNumber;
            const isMarked = markedClues.has(clueNum);
            this.updateHotspotAppearance(hotspot, isMarked);
        }
    }

    getDetectedClues() {
        return this.detectedClues;
    }
}

window.ClueDetector = ClueDetector;
