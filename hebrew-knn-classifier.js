// ========================
// Hebrew Handwriting Recognition
// Using TensorFlow.js KNN Classifier
// ========================

class HebrewKNNClassifier {
    constructor() {
        this.classifier = null;
        this.isReady = false;
        
        // Hebrew alphabet (22 letters + 5 final forms)
        this.hebrewLetters = [
            'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ך',
            'ל', 'מ', 'ם', 'נ', 'ן', 'ס', 'ע', 'פ', 'ף', 'צ', 'ץ', 'ק',
            'ר', 'ש', 'ת'
        ];
        
        this.trainingData = {}; // Store training examples per letter
    }

    async initialize() {
        if (this.isReady) return;
        
        console.log('Initializing TensorFlow.js KNN Classifier...');
        
        // Load TensorFlow.js and KNN Classifier
        await this.loadTensorFlow();
        
        // Create KNN classifier
        this.classifier = window.knnClassifier.create();
        
        this.isReady = true;
        console.log('✅ KNN Classifier ready!');
    }

    async loadTensorFlow() {
        // TensorFlow.js is loaded via CDN in HTML
        // Wait for it to be available
        return new Promise((resolve) => {
            const checkTF = setInterval(() => {
                if (window.tf && window.knnClassifier) {
                    clearInterval(checkTF);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * Capture canvas drawing and convert to tensor
     * @param {HTMLCanvasElement} canvas - The drawing canvas
     * @returns {tf.Tensor} - 28x28 grayscale tensor
     */
    captureDrawing(canvas) {
        // Get canvas data
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Create temporary canvas for 28x28 resize
        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = 28;
        resizeCanvas.height = 28;
        const resizeCtx = resizeCanvas.getContext('2d');
        
        // Draw resized image
        resizeCtx.fillStyle = 'white';
        resizeCtx.fillRect(0, 0, 28, 28);
        resizeCtx.drawImage(canvas, 0, 0, 28, 28);
        
        // Get pixel data
        const resizedData = resizeCtx.getImageData(0, 0, 28, 28);
        
        // Convert to grayscale tensor
        const grayscaleData = new Float32Array(28 * 28);
        for (let i = 0; i < resizedData.data.length; i += 4) {
            // Convert RGBA to grayscale (invert: white=1, black=0)
            const r = resizedData.data[i];
            const g = resizedData.data[i + 1];
            const b = resizedData.data[i + 2];
            const gray = (r + g + b) / 3;
            grayscaleData[i / 4] = gray / 255; // Normalize to 0-1
        }
        
        // Create tensor [28, 28, 1]
        return tf.tensor3d(grayscaleData, [28, 28, 1]);
    }

    /**
     * Train the classifier with a new example
     * @param {HTMLCanvasElement} canvas - Canvas with drawing
     * @param {string} label - Hebrew letter (e.g., 'א')
     */
    async train(canvas, label) {
        if (!this.isReady) {
            console.error('Classifier not initialized!');
            return false;
        }

        // Capture drawing as tensor
        const tensor = this.captureDrawing(canvas);
        
        // Add to classifier
        this.classifier.addExample(tensor, label);
        
        // Store in training data
        if (!this.trainingData[label]) {
            this.trainingData[label] = [];
        }
        this.trainingData[label].push(Date.now());
        
        console.log(`✅ Trained: ${label} (${this.trainingData[label].length} examples)`);
        
        // Clean up tensor
        tensor.dispose();
        
        return true;
    }

    /**
     * Predict Hebrew letter from canvas drawing
     * @param {HTMLCanvasElement} canvas - Canvas with drawing
     * @returns {Object} - {letter: 'א', confidence: 0.95}
     */
    async predict(canvas) {
        if (!this.isReady) {
            console.error('Classifier not initialized!');
            return null;
        }

        const numClasses = this.classifier.getNumClasses();
        if (numClasses === 0) {
            console.warn('No training data yet!');
            return null;
        }

        // Capture drawing as tensor
        const tensor = this.captureDrawing(canvas);
        
        try {
            // Get prediction
            const result = await this.classifier.predictClass(tensor);
            
            // Clean up tensor
            tensor.dispose();
            
            return {
                letter: result.label,
                confidence: result.confidences[result.label],
                allConfidences: result.confidences
            };
        } catch (error) {
            console.error('Prediction error:', error);
            tensor.dispose();
            return null;
        }
    }

    /**
     * Get number of training examples per letter
     */
    getTrainingStats() {
        const stats = {};
        for (const letter of this.hebrewLetters) {
            stats[letter] = this.trainingData[letter]?.length || 0;
        }
        return stats;
    }

    /**
     * Save trained model to localStorage
     */
    async saveModel() {
        if (!this.isReady || this.classifier.getNumClasses() === 0) {
            console.warn('No model to save!');
            return false;
        }

        try {
            const dataset = this.classifier.getClassifierDataset();
            const datasetObj = {};
            
            Object.keys(dataset).forEach(key => {
                const data = dataset[key].dataSync();
                datasetObj[key] = Array.from(data);
            });
            
            localStorage.setItem('hebrew_knn_model', JSON.stringify({
                dataset: datasetObj,
                trainingData: this.trainingData,
                timestamp: Date.now()
            }));
            
            console.log('✅ Model saved to localStorage');
            return true;
        } catch (error) {
            console.error('Save error:', error);
            return false;
        }
    }

    /**
     * Load trained model from localStorage
     */
    async loadModel() {
        if (!this.isReady) {
            console.error('Classifier not initialized!');
            return false;
        }

        try {
            const saved = localStorage.getItem('hebrew_knn_model');
            if (!saved) {
                console.warn('No saved model found');
                return false;
            }

            const { dataset, trainingData } = JSON.parse(saved);
            
            Object.keys(dataset).forEach(key => {
                const data = dataset[key];
                const tensor = tf.tensor(data, [data.length / (28 * 28), 28, 28, 1]);
                this.classifier.addExample(tensor, key);
                tensor.dispose();
            });
            
            this.trainingData = trainingData;
            
            console.log('✅ Model loaded from localStorage');
            return true;
        } catch (error) {
            console.error('Load error:', error);
            return false;
        }
    }

    /**
     * Clear all training data
     */
    clearModel() {
        this.classifier.clearAllClasses();
        this.trainingData = {};
        localStorage.removeItem('hebrew_knn_model');
        console.log('🗑️ Model cleared');
    }

    /**
     * Get classifier info
     */
    getInfo() {
        return {
            isReady: this.isReady,
            numClasses: this.classifier ? this.classifier.getNumClasses() : 0,
            trainingStats: this.getTrainingStats()
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HebrewKNNClassifier;
}
