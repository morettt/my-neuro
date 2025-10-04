// motion-hotkey-manager.js - 动作快捷键管理器
const { ipcRenderer } = require('electron');

class MotionHotkeyManager {
    constructor(emotionMapper) {
        this.emotionMapper = emotionMapper;
        this.isEnabled = true;
        this.lastMotionTime = 0;
        this.cooldownMs = 500; // 防止过快触发的冷却时间
        
        // 快捷键映射表
        this.hotkeyMap = {
            1: { index: 1, name: '愧疚', description: '皱眉，双手放背后，扭捏表情' },
            2: { index: 2, name: '开心高', description: '左右歪头，结尾闭眼笑嘻嘻' },
            3: { index: 3, name: '开心低', description: '双手对称摇动，头左右摇动' },
            4: { index: 4, name: '愧疚', description: '皱眉，双手放背后，扭捏表情'  },
            5: { index: 5, name: '俏皮', description: '手臂抬至胸前，由中间向外展开' },
            6: { index: 6, name: '惊讶', description: '双手放到背后，身体一抖，惊愕状' },
            7: { index: 7, name: '兴奋', description: '双手抬至胸前快速展开，结尾笑脸' },
            8: { index: 8, name: '赌气', description: '抬眉毛，然后半闭眼赌气' },
            9: { index: 9, name: '打开麦克风', description: '打开麦克风' }
        };
        
        this.setupKeyboardListeners();
    }
    
    // 设置键盘监听器（渲染进程内的监听）
    setupKeyboardListeners() {
        document.addEventListener('keydown', (e) => {
            if (!this.isEnabled) return;
            
            // 检查是否按下了 Ctrl+Shift
            if (e.ctrlKey && e.shiftKey) {
                const keyNum = parseInt(e.key);
                
                // 检查是否是数字键 1-9
                if (keyNum >= 1 && keyNum <= 9) {
                    e.preventDefault(); // 阻止默认行为
                    this.triggerMotion(keyNum);
                }
                // 数字键 0 - 停止所有动作
                else if (e.key === '0') {
                    e.preventDefault();
                    this.stopAllMotions();
                }
            }
        });
    }
    
    // 触发动作
    triggerMotion(hotkeyNumber) {
        // 检查冷却时间
        const currentTime = Date.now();
        if (currentTime - this.lastMotionTime < this.cooldownMs) {
            console.log('动作触发过快，请稍后再试');
            return;
        }
        
        const motionInfo = this.hotkeyMap[hotkeyNumber];
        if (!motionInfo) {
            console.error(`无效的快捷键编号: ${hotkeyNumber}`);
            return;
        }
        
        // 记录触发时间
        this.lastMotionTime = currentTime;
        
        // 触发动作
        if (this.emotionMapper) {
            console.log(`快捷键 Ctrl+Shift+${hotkeyNumber} 触发: ${motionInfo.name} - ${motionInfo.description}`);
            this.emotionMapper.playMotion(motionInfo.index);
            
            // 可选：显示提示
            if (typeof showSubtitle === 'function') {
                showSubtitle(`动作: ${motionInfo.name}`, 1500);
            }
        }
    }
    
    // 停止所有动作
    stopAllMotions() {
        if (this.emotionMapper && this.emotionMapper.model) {
            const model = this.emotionMapper.model;
            if (model.internalModel && model.internalModel.motionManager) {
                model.internalModel.motionManager.stopAllMotions();
                console.log('所有动作已停止');
                
                // 播放默认待机动作
                this.emotionMapper.playDefaultMotion();
                
                if (typeof showSubtitle === 'function') {
                    showSubtitle('动作已重置', 1000);
                }
            }
        }
    }
    
    // 启用/禁用快捷键
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log(`动作快捷键已${enabled ? '启用' : '禁用'}`);
    }
    
    // 获取快捷键列表（用于显示帮助）
    getHotkeyList() {
        let list = "动作快捷键列表：\n";
        for (let i = 1; i <= 9; i++) {
            const info = this.hotkeyMap[i];
            list += `Ctrl+Shift+${i}: ${info.name} - ${info.description}\n`;
        }
        list += "Ctrl+Shift+0: 停止所有动作并重置";
        return list;
    }
}

module.exports = { MotionHotkeyManager };