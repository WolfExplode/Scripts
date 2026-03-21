// ==UserScript==
// @name         Aspect Ratio Calculator
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Aspect ratio calculator UI only
// @author       WXP
// @match        http://127.0.0.1:8188/*
// @grant        GM_addStyle
// ==/UserScript==


(function () {
    'use strict';

    const STORAGE_KEY = 'ar_calc_settings';

    // Load saved settings
    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            console.error('Failed to load AR settings', e);
            return null;
        }
    }

    // Save settings
    function saveSettings(settings) {
        try {
            const current = loadSettings() || {};
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
        } catch (e) {
            console.error('Failed to save AR settings', e);
        }
    }

    const savedSettings = loadSettings() || {};

    // Create container
    const container = document.createElement('div');
    container.id = 'ar-calculator';
    if (savedSettings.collapsed) {
        container.classList.add('ar-collapsed');
    }
    if (savedSettings.x !== undefined && savedSettings.y !== undefined) {
        container.style.transform = `translate(${savedSettings.x}px, ${savedSettings.y}px)`;
    }
    container.innerHTML = `
        <div class="ar-header">
            <span>Aspect Ratio Calculator</span>
        </div>
        
        <div class="ar-body">
            <!-- Settings Row -->
            <div class="ar-settings-row">
                <div class="ar-setting-col">
                    <label>Ratio</label>
                    <select id="ar-ratio-select">
                        <option value="custom">Custom</option>
                        <option value="0.42857142857">9:21</option>
                        <option value="0.5625">9:16</option>
                        <option value="0.66666666667">2:3</option>
                        <option value="0.75">3:4</option>
                        <option value="1">1:1</option>
                        <option value="1.33333333333">4:3</option>
                        <option value="1.5">3:2</option>
                        <option value="1.77777777778">16:9</option>
                        <option value="2.33333333333">21:9</option>
                    </select>
                </div>
                <div class="ar-setting-col">
                    <label>Multiple Of</label>
                    <select id="ar-constraint">
                        <option value="1">None</option>
                        <option value="8" selected>8</option>
                        <option value="16">16</option>
                        <option value="32">32</option>
                        <option value="64">64</option>
                    </select>
                </div>
            </div>

            <!-- Width Section -->
            <div class="ar-input-group">
                <label>Width</label>
                <div class="ar-input-wrapper">
                    <input type="number" id="ar-width" placeholder="1920" min="1" value="${savedSettings.width || ''}">
                </div>
            </div>

            <!-- Swap Icon -->
            <div class="ar-swap">
                <button class="ar-swap-btn" title="Swap dimensions">⇅</button>
            </div>

            <!-- Height Section -->
            <div class="ar-input-group">
                <label>Height</label>
                <div class="ar-input-wrapper">
                    <input type="number" id="ar-height" placeholder="1080" min="1" value="${savedSettings.height || ''}">
                </div>
            </div>

            <!-- Custom Ratio Calculation Check -->
            <div class="ar-calc-action" id="ar-calc-ratio-container" style="display: none;">
                <button class="ar-calc-btn" id="ar-calc-ratio-btn">Calculate New Aspect Ratio</button>
            </div>

            <!-- Ratio Display -->
            <div class="ar-ratio-display">
                <span class="ar-label">Ratio:</span>
                <span class="ar-value" id="ar-ratio">-- : --</span>
            </div>

            <!-- Scale Controls -->
            <div class="ar-scale-controls">
                <button class="ar-scale-btn" data-action="decrease" title="Decrease Scale">◀</button>
                <button class="ar-scale-btn" data-action="increase" title="Increase Scale">▶</button>
            </div>

            <!-- Target Resolution Section -->
            <div class="ar-divider">Upscaling</div>
            <div class="ar-settings-row">
                <div class="ar-setting-col">
                    <label>Target W</label>
                    <input type="number" id="ar-target-width" class="ar-small-input" placeholder="2048" min="1" value="${savedSettings.targetWidth || ''}">
                </div>
                <div class="ar-setting-col">
                    <label>Target H</label>
                    <input type="number" id="ar-target-height" class="ar-small-input" placeholder="2048" min="1" value="${savedSettings.targetHeight || ''}">
                </div>
            </div>

            <!-- Upscale Display -->
            <div class="ar-ratio-display ar-upscale-row">
                <span class="ar-label">Upscale Factor:</span>
                <span class="ar-value" id="ar-upscale-factor">-- x</span>
            </div>
        </div>
    `;

    document.body.appendChild(container);

    // Add styles
    GM_addStyle(`
        #ar-calculator {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 280px;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 999999;
            overflow: hidden;
            user-select: none;
        }

        .ar-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            font-weight: 600;
            font-size: 14px;
        }



        .ar-body {
            padding: 20px;
        }

        .ar-input-group {
            margin-bottom: 12px;
        }

        .ar-settings-row {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
        }

        .ar-setting-col {
            flex: 1;
        }

        .ar-setting-col label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            color: #555;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .ar-setting-col select {
            width: 100%;
            padding: 8px;
            border: 2px solid #e1e4e8;
            border-radius: 8px;
            font-size: 13px;
            color: #333;
            outline: none;
            cursor: pointer;
            background-color: #f6f8fa;
        }

        .ar-setting-col select:focus {
            border-color: #667eea;
        }

        .ar-input-group label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #555;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .ar-input-wrapper {
            display: flex;
            gap: 8px;
            align-items: stretch;
        }

        .ar-input-wrapper input {
            flex: 1;
            padding: 10px 12px;
            border: 2px solid #e1e4e8;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            color: #333;
            background: #ffffff;
            transition: border-color 0.2s;
            outline: none;
        }

        .ar-input-wrapper input:focus {
            border-color: #667eea;
        }

        .ar-scale-controls {
            display: flex;
            gap: 12px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e1e4e8;
        }

        .ar-scale-btn {
            flex: 1;
            background: #f6f8fa;
            border: 2px solid #e1e4e8;
            border-radius: 8px;
            cursor: pointer;
            padding: 8px;
            font-size: 14px;
            color: #555;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .ar-scale-btn:hover {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }

        .ar-scale-btn:active {
            transform: scale(0.95);
        }

        .ar-calc-action {
            margin-top: 12px;
        }

        .ar-calc-btn {
            width: 100%;
            background: #f6f8fa;
            border: 2px solid #e1e4e8;
            border-radius: 8px;
            padding: 8px;
            color: #555;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .ar-calc-btn:hover {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }

        .ar-calc-btn:active {
            transform: scale(0.95);
        }

        .ar-swap {
            display: flex;
            justify-content: center;
            margin: 8px 0;
        }

        .ar-swap-btn {
            background: #f6f8fa;
            border: 2px solid #e1e4e8;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            cursor: pointer;
            font-size: 16px;
            color: #667eea;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .ar-swap-btn:hover {
            background: #667eea;
            color: white;
            border-color: #667eea;
            transform: rotate(180deg);
        }

        .ar-ratio-display {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e1e4e8;
            text-align: center;
        }

        .ar-label {
            font-size: 12px;
            color: #777;
            margin-right: 8px;
        }

        .ar-value {
            font-size: 18px;
            font-weight: 700;
            color: #333;
            font-family: "Courier New", monospace;
        }

        .ar-divider {
            font-size: 11px;
            font-weight: 700;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 16px 0 12px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .ar-divider::after {
            content: "";
            flex: 1;
            height: 1px;
            background: #e1e4e8;
        }

        .ar-small-input {
            width: 100%;
            padding: 8px;
            border: 2px solid #e1e4e8;
            border-radius: 8px;
            font-size: 13px;
            color: #333;
            outline: none;
            background-color: #f6f8fa;
            box-sizing: border-box;
        }

        .ar-small-input:focus {
            border-color: #667eea;
        }

        .ar-upscale-row {
            margin-top: 12px;
            padding-top: 12px;
            border-top: none;
            background: #f8f9ff;
            border-radius: 8px;
            padding: 10px;
        }

        .ar-upscale-row .ar-value {
            color: #667eea;
        }

        /* Collapsed State */
        #ar-calculator.ar-collapsed .ar-body {
            display: none;
        }
        
        #ar-calculator.ar-collapsed {
            width: auto;
            min-width: 200px;
        }
    `);

    let isDragging = false;
    let hasDragged = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = savedSettings.x || 0;
    let yOffset = savedSettings.y || 0;
    let lockedCustomRatio = savedSettings.lockedCustomRatio || null; // State for custom locking

    // Constraint helper
    function snapToMultiple(val, multiple) {
        if (multiple <= 1) return val;
        return Math.round(val / multiple) * multiple;
    }

    // GCD helper for ratio display
    function gcd(a, b) {
        return b === 0 ? a : gcd(b, a % b);
    }

    // Update function to sync UI
    function updateDimensions(source) {
        const widthInput = container.querySelector('#ar-width');
        const heightInput = container.querySelector('#ar-height');
        const targetWidthInput = container.querySelector('#ar-target-width');
        const targetHeightInput = container.querySelector('#ar-target-height');
        const ratioSelect = container.querySelector('#ar-ratio-select');
        const constraintSelect = container.querySelector('#ar-constraint');
        const calcBtnContainer = container.querySelector('#ar-calc-ratio-container');
        const upscaleFactorDisplay = container.querySelector('#ar-upscale-factor');

        // Manage button visibility
        if (ratioSelect.value === 'custom') {
            calcBtnContainer.style.display = 'block';
        } else {
            calcBtnContainer.style.display = 'none';
        }

        // Get current values
        let w = parseInt(widthInput.value) || 0;
        let h = parseInt(heightInput.value) || 0;
        let targetW = parseInt(targetWidthInput.value) || 0;
        let targetH = parseInt(targetHeightInput.value) || 0;
        const constraint = parseInt(constraintSelect.value) || 1;

        // Determine Target Ratio
        let targetRatio = null;
        if (ratioSelect.value !== 'custom') {
            targetRatio = parseFloat(ratioSelect.value);
            lockedCustomRatio = null; // Reset custom lock if not custom
        } else {
            // If we are in custom mode, checking if we have a locked ratio
            if (lockedCustomRatio) {
                targetRatio = lockedCustomRatio;
            }
        }

        // Application Logic for Base Dimensions
        if (source === 'constraint') {
            // Re-snap existing values
            if (w) w = snapToMultiple(w, constraint);
            if (h) h = snapToMultiple(h, constraint);
            widthInput.value = w;
            heightInput.value = h;
        } else if (source === 'ratio' && targetRatio) {
            // New ratio selected, update Height based on Width
            if (!w) w = 1024;
            w = snapToMultiple(w, constraint);
            h = w / targetRatio;
            h = snapToMultiple(h, constraint);
            widthInput.value = w;
            heightInput.value = h;
        } else if (source === 'calcClick' && w > 0 && h > 0) {
            // User clicked Calculate, lock this ratio
            lockedCustomRatio = w / h;
            targetRatio = lockedCustomRatio;
            // No need to change values, just state updated.
        } else if (targetRatio) {
            // We have a target ratio (preset OR locked custom)
            // Check which input changed
            if (source === 'width' && w) {
                h = w / targetRatio;
                h = snapToMultiple(h, constraint);
                heightInput.value = h;
            } else if (source === 'height' && h) {
                w = h * targetRatio;
                w = snapToMultiple(w, constraint);
                widthInput.value = w;
            }
        }

        // Application Logic for Target Dimensions
        if (targetRatio) {
            if (source === 'targetWidth' && targetW) {
                targetH = Math.round(targetW / targetRatio);
                targetHeightInput.value = targetH;
            } else if (source === 'targetHeight' && targetH) {
                targetW = Math.round(targetH * targetRatio);
                targetWidthInput.value = targetW;
            } else if (source === 'width' || source === 'height' || source === 'ratio' || source === 'calcClick') {
                // If base dimension or ratio changed, we might want to update target dimensions to maintain the SAME UPSCALE FACTOR
                // However, usually users want to see the factor CHANGE when they change base.
                // But it's also helpful if they change ratio, target dimensions update to match.
                if (targetW) {
                    targetH = Math.round(targetW / (w / h || targetRatio));
                    targetHeightInput.value = targetH;
                }
            }
        }

        // Calculate Upscale Factor
        if (w > 0 && targetW > 0) {
            const factor = targetW / w;
            upscaleFactorDisplay.textContent = factor.toFixed(3) + ' x';
        } else {
            upscaleFactorDisplay.textContent = '-- x';
        }

        // Update ratio display
        const ratioDisplay = container.querySelector('#ar-ratio');
        if (ratioSelect.value !== 'custom') {
            // Show selected option text (e.g. 16:9)
            const optionText = ratioSelect.options[ratioSelect.selectedIndex].text;
            const val = parseFloat(ratioSelect.value);
            ratioDisplay.textContent = `${val.toFixed(3)} (${optionText})`;
        } else {
            // Custom display
            if (w && h) {
                const actualRatio = w / h;
                const divisor = gcd(w, h);
                const ratioText = `${w / divisor}:${h / divisor}`;
                ratioDisplay.textContent = `${actualRatio.toFixed(3)} (${ratioText})`;
                if (lockedCustomRatio) {
                    ratioDisplay.textContent += ' 🔒';
                }
            } else {
                ratioDisplay.textContent = '-- : --';
            }
        }

        // Save state
        saveSettings({
            width: w,
            height: h,
            targetWidth: targetW,
            targetHeight: targetH,
            ratio: ratioSelect.value,
            constraint: constraint,
            lockedCustomRatio: lockedCustomRatio
        });
    }

    // Initialize dropdowns from saved state
    if (savedSettings.ratio) {
        container.querySelector('#ar-ratio-select').value = savedSettings.ratio;
    }
    if (savedSettings.constraint) {
        container.querySelector('#ar-constraint').value = savedSettings.constraint;
    }
    // Initial display update
    updateDimensions(); // Compute initial ratio text
    let minX, maxX, minY, maxY;

    const header = container.querySelector('.ar-header');

    header.addEventListener('mousedown', dragStart);
    header.addEventListener('click', toggleCollapse);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        if (e.target === header || e.target.closest('.ar-header')) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
            hasDragged = false;

            // Calculate boundaries relative to the initial position (zero transform)
            const rect = container.getBoundingClientRect();

            // Current "zero" position (position if transform were 0,0)
            const zeroLeft = rect.left - xOffset;
            const zeroTop = rect.top - yOffset;

            // Calculate min/max translation values to keep element within viewport
            minX = -zeroLeft;
            maxX = window.innerWidth - rect.width - zeroLeft;
            minY = -zeroTop;
            maxY = window.innerHeight - rect.height - zeroTop;
        }
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            hasDragged = true;

            const rawX = e.clientX - initialX;
            const rawY = e.clientY - initialY;

            // Constrain to boundaries
            currentX = Math.min(Math.max(rawX, minX), maxX);
            currentY = Math.min(Math.max(rawY, minY), maxY);

            xOffset = currentX;
            yOffset = currentY;

            container.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }

    function dragEnd(e) {
        isDragging = false;
        if (hasDragged) {
            saveSettings({
                x: xOffset,
                y: yOffset
            });
        }
    }

    function toggleCollapse(e) {
        if (!hasDragged) {
            container.classList.toggle('ar-collapsed');
            saveSettings({
                collapsed: container.classList.contains('ar-collapsed')
            });
        }
    }



    // Placeholder event listeners (no logic yet)
    // Scale buttons
    container.querySelectorAll('.ar-scale-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const widthInput = container.querySelector('#ar-width');
            const heightInput = container.querySelector('#ar-height');
            const constraintSelect = container.querySelector('#ar-constraint');
            const ratioSelect = container.querySelector('#ar-ratio-select');

            let w = parseInt(widthInput.value) || 0;
            let h = parseInt(heightInput.value) || 0;
            const constraint = parseInt(constraintSelect.value) || 1;

            if (w && h) {
                // Determine ratio source: dropdown or current values
                let ratio;
                if (ratioSelect.value !== 'custom') {
                    ratio = parseFloat(ratioSelect.value);
                } else {
                    ratio = w / h;
                }
                let newW;

                if (constraint > 1) {
                    if (action === 'increase') {
                        newW = (Math.floor(w / constraint) + 1) * constraint;
                    } else {
                        newW = (Math.ceil(w / constraint) - 1) * constraint;
                    }
                } else {
                    const step = 20;
                    if (action === 'increase') {
                        newW = w + step;
                    } else {
                        newW = w - step;
                    }
                }

                newW = Math.max(1, newW);

                // Calculate height based on kept ratio
                let newH = newW / ratio;

                // Snap height to constraint if active
                if (constraint > 1) {
                    newH = snapToMultiple(newH, constraint);
                } else {
                    newH = Math.round(newH);
                }
                newH = Math.max(1, newH);

                widthInput.value = newW;
                heightInput.value = newH;

                // Update displayed ratio
                updateDimensions();
            }
        });
    });

    container.querySelector('.ar-swap-btn').addEventListener('click', () => {
        const widthInput = container.querySelector('#ar-width');
        const heightInput = container.querySelector('#ar-height');
        const ratioSelect = container.querySelector('#ar-ratio-select');

        const w = widthInput.value;
        const h = heightInput.value;

        widthInput.value = h;
        heightInput.value = w;

        // Reset ratio dropdown to custom and lock the new ratio
        ratioSelect.value = 'custom';
        updateDimensions('calcClick');
    });

    // Calculate Button Listener
    container.querySelector('#ar-calc-ratio-btn').addEventListener('click', () => {
        updateDimensions('calcClick');
    });

    // Input change listeners
    container.querySelector('#ar-width').addEventListener('input', () => {
        updateDimensions('width');
    });

    container.querySelector('#ar-height').addEventListener('input', () => {
        updateDimensions('height');
    });

    container.querySelector('#ar-target-width').addEventListener('input', () => {
        updateDimensions('targetWidth');
    });

    container.querySelector('#ar-target-height').addEventListener('input', () => {
        updateDimensions('targetHeight');
    });

    container.querySelector('#ar-ratio-select').addEventListener('change', () => {
        updateDimensions('ratio');
    });

    container.querySelector('#ar-constraint').addEventListener('change', () => {
        updateDimensions('constraint');
    });

})();