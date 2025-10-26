// js/ui/ui-controller.js
// ui-controller.js - UI控制模块 (重构版 - 支持交互时暂停隐藏)
const { ipcRenderer } = require('electron');

class UIController {
    static _measureContext = null;

    constructor(config) {
        this.config = config;
        this.subtitleTimeout = null;

        const subtitleConfig = config.ui?.subtitle || {};
        this.autoHideEnabled = subtitleConfig.auto_hide ?? true;
        this.autoHideDuration = subtitleConfig.hide_delay ?? 8000;

        this.fontStyle = {
            fontSize: subtitleConfig.style?.font_size || '30px',
            fontFamily: subtitleConfig.style?.font_family || "'Patrick Hand', 'ZCOOL QingKe HuangYou', sans-serif",
            color: subtitleConfig.style?.color || 'white'
        };

        this.subtitleContainer = document.getElementById('subtitle-container');
        this.subtitleContentWrapper = document.getElementById('subtitle-content-wrapper');
        this.subtitleDragHandle = document.getElementById('subtitle-drag-handle');
        this.subtitleResizeHandle = document.getElementById('subtitle-resize-handle');

        this._lines = [];
        this._dirty = false;
        this._animationFrameId = null;

        this.isDraggingSubtitle = false;
        this.isResizingSubtitle = false;
        this.dragStartPos = { x: 0, y: 0 };
        this.resizeStartSize = { width: 0, height: 0 };

        if (!UIController._measureContext) {
            const canvas = document.createElement('canvas');
            UIController._measureContext = canvas.getContext('2d');
        }
    }

    async initialize() {
        await this.loadSubtitlePosition();
        await this.loadSubtitleSize();
        this.initDraggableSubtitle();
        this.initResizableSubtitle();
        this._applyStylesFromConfig();
        this.startRenderLoop();
    }

    _applyStylesFromConfig() {
        const css = `
            .subtitle-line {
                font-size: ${this.fontStyle.fontSize};
                font-family: ${this.fontStyle.fontFamily};
                color: ${this.fontStyle.color};
            }
        `;
        const styleElement = document.createElement('style');
        styleElement.id = 'dynamic-subtitle-styles';
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
    }

    _getWrapperWidth() {
        const style = window.getComputedStyle(this.subtitleContentWrapper);
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const paddingRight = parseFloat(style.paddingRight) || 0;
        return this.subtitleContentWrapper.clientWidth - paddingLeft - paddingRight;
    }

    _wrapText(text) {
        const context = UIController._measureContext;
        const existingLine = this.subtitleContentWrapper.querySelector('.subtitle-line');
        if (existingLine) {
             context.font = window.getComputedStyle(existingLine).font;
        } else {
            const tempLine = document.createElement('div');
            tempLine.className = 'subtitle-line';
            tempLine.style.visibility = 'hidden';
            this.subtitleContentWrapper.appendChild(tempLine);
            context.font = window.getComputedStyle(tempLine).font;
            this.subtitleContentWrapper.removeChild(tempLine);
        }
        
        const maxWidth = this._getWrapperWidth();
        if (maxWidth <= 0) return [text];

        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            if (context.measureText(word).width > maxWidth) {
                if (currentLine.length > 0) {
                    lines.push(currentLine.trim());
                    currentLine = '';
                }
                let tempWord = '';
                for (const char of word) {
                    if (context.measureText(tempWord + char).width > maxWidth) {
                        lines.push(tempWord);
                        tempWord = char;
                    } else {
                        tempWord += char;
                    }
                }
                currentLine = tempWord;
            } else {
                const testLine = currentLine.length > 0 ? `${currentLine} ${word}` : word;
                if (context.measureText(testLine).width > maxWidth) {
                    lines.push(currentLine.trim());
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
        }
        if (currentLine.length > 0) {
            lines.push(currentLine.trim());
        }
        return lines;
    }

    startRenderLoop() {
        if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);
        this._render();
    }

    stopRenderLoop() {
        if (this._animationFrameId) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }
    }

    _render() {
        this._animationFrameId = requestAnimationFrame(() => this._render());
        if (!this._dirty) return;
        this._dirty = false;
        if (this._lines.length === 0) {
            if (this.subtitleContainer.style.display !== 'none') {
                this.subtitleContainer.style.display = 'none';
            }
            return;
        }
        if (this.subtitleContainer.style.display !== 'block') {
            this.subtitleContainer.style.display = 'block';
        }
        this.subtitleContentWrapper.innerHTML = '';
        const linesToRender = [];
        this._lines.forEach(line => {
            linesToRender.push(...this._wrapText(line));
        });
        linesToRender.forEach(lineText => {
            const lineElement = document.createElement('div');
            lineElement.className = 'subtitle-line';
            lineElement.textContent = lineText;
            this.subtitleContentWrapper.appendChild(lineElement);
        });
        while (this.subtitleContentWrapper.scrollHeight > this.subtitleContentWrapper.clientHeight) {
            if (this.subtitleContentWrapper.children.length <= 1) {
                break;
            }
            this.subtitleContentWrapper.removeChild(this.subtitleContentWrapper.firstChild);
        }
    }
    
    _resetAutoHideTimer() {
        if (!this.autoHideEnabled) return;
        if (this.subtitleTimeout) clearTimeout(this.subtitleTimeout);
        this.subtitleTimeout = setTimeout(() => this.clear(), this.autoHideDuration);
    }
    
    // --- 核心修改：新增 forceShow 方法 ---
    forceShow() {
        this.subtitleContainer.style.display = 'block';
        if (this._lines.length === 0) {
            this._lines.push('...');
        }
        this._dirty = true;
        this._resetAutoHideTimer();
    }

    startNewSubtitle(prefix) {
        this._lines = [prefix];
        this._dirty = true;
        this._resetAutoHideTimer();
    }

    updateLastLine(text) {
        if (this._lines.length > 0) {
            this._lines[this._lines.length - 1] = text;
        } else {
            this._lines.push(text);
        }
        this._dirty = true;
        this._resetAutoHideTimer();
    }

    addNewLine(text, duration = null) {
        if (this.subtitleTimeout) clearTimeout(this.subtitleTimeout);
        if (duration) {
            this._lines = [];
            this.subtitleTimeout = setTimeout(() => this.clear(), duration);
        } else {
             this._resetAutoHideTimer();
        }
        this._lines.push(text);
        this._dirty = true;
    }

    clear() {
        if (this.subtitleTimeout) {
            clearTimeout(this.subtitleTimeout);
            this.subtitleTimeout = null;
        }
        this._lines = [];
        this._dirty = true;
    }
    
    initDraggableSubtitle() {
        const onMouseDown = (e) => {
            if (this.isResizingSubtitle) return;
            // --- 核心修改：暂停计时器 ---
            if (this.subtitleTimeout) clearTimeout(this.subtitleTimeout);
            this.isDraggingSubtitle = true;
            this.dragStartPos = { x: e.clientX, y: e.clientY };
            const rect = this.subtitleContainer.getBoundingClientRect();
            this.subtitleContainer.style.left = `${rect.left}px`;
            this.subtitleContainer.style.top = `${rect.top}px`;
            this.subtitleContainer.style.right = 'auto';
            this.subtitleContainer.style.bottom = 'auto';
            this.subtitleContainer.style.transform = 'none';
            this.subtitleDragHandle.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        const onMouseMove = (e) => {
            if (this.isDraggingSubtitle) {
                const rect = this.subtitleContainer.getBoundingClientRect();
                const newLeft = rect.left + (e.clientX - this.dragStartPos.x);
                const newTop = rect.top + (e.clientY - this.dragStartPos.y);
                this.subtitleContainer.style.left = `${newLeft}px`;
                this.subtitleContainer.style.top = `${newTop}px`;
                this.dragStartPos = { x: e.clientX, y: e.clientY };
            }
        };
        const onMouseUp = () => {
            if (this.isDraggingSubtitle) {
                this.isDraggingSubtitle = false;
                this.subtitleDragHandle.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.saveSubtitlePosition();
                // --- 核心修改：重启计时器 ---
                this._resetAutoHideTimer();
            }
        };
        this.subtitleDragHandle.addEventListener('mousedown', onMouseDown);
    }

    initResizableSubtitle() {
        const onMouseDown = (e) => {
            e.stopPropagation();
            // --- 核心修改：暂停计时器 ---
            if (this.subtitleTimeout) clearTimeout(this.subtitleTimeout);
            this.isResizingSubtitle = true;
            this.dragStartPos = { x: e.clientX, y: e.clientY };
            const rect = this.subtitleContainer.getBoundingClientRect();
            this.resizeStartSize = { width: rect.width, height: rect.height };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        const onMouseMove = (e) => {
            if (this.isResizingSubtitle) {
                const dx = e.clientX - this.dragStartPos.x;
                const dy = e.clientY - this.dragStartPos.y;
                let newWidth = this.resizeStartSize.width + dx;
                let newHeight = this.resizeStartSize.height + dy;
                newWidth = Math.max(150, newWidth);
                newHeight = Math.max(80, newHeight);
                this.subtitleContainer.style.width = `${newWidth}px`;
                this.subtitleContainer.style.height = `${newHeight}px`;
            }
        };
        const onMouseUp = () => {
            if (this.isResizingSubtitle) {
                this.isResizingSubtitle = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.saveSubtitleSize();
                // --- 核心修改：重启计时器 ---
                this._resetAutoHideTimer();
            }
        };
        this.subtitleResizeHandle.addEventListener('mousedown', onMouseDown);
    }

    async loadSubtitlePosition() {
        try {
            const result = await ipcRenderer.invoke('get-layout-config');
            if (result.success && result.config && result.config.subtitle_position) {
                const pos = result.config.subtitle_position;
                this.subtitleContainer.style.left = `${pos.x * window.innerWidth}px`;
                this.subtitleContainer.style.top = `${pos.y * window.innerHeight}px`;
                this.subtitleContainer.style.transform = 'none';
            }
        } catch (error) {
            console.error("加载字幕位置失败:", error);
        }
    }

    async loadSubtitleSize() {
        try {
            const result = await ipcRenderer.invoke('get-layout-config');
            if (result.success && result.config && result.config.subtitle_size) {
                const size = result.config.subtitle_size;
                this.subtitleContainer.style.width = `${size.width}px`;
                this.subtitleContainer.style.height = `${size.height}px`;
            }
        } catch (error) {
            console.error("加载字幕尺寸失败:", error);
        }
    }

    saveSubtitlePosition() {
        const subtitleRect = this.subtitleContainer.getBoundingClientRect();
        const relativePos = {
            x: subtitleRect.left / window.innerWidth,
            y: subtitleRect.top / window.innerHeight
        };
        ipcRenderer.send('save-subtitle-position', relativePos);
    }

    saveSubtitleSize() {
        const subtitleRect = this.subtitleContainer.getBoundingClientRect();
        const size = {
            width: subtitleRect.width,
            height: subtitleRect.height
        };
        ipcRenderer.send('save-subtitle-size', size);
    }
}

module.exports = { UIController };