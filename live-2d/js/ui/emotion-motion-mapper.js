// synchronized-emotion-motion-mapper.js - 基于角色的情绪动作映射器
class EmotionMotionMapper {
    constructor(model) {
        this.model = model;
        this.currentMotionGroup = "TapBody";
        this.emotionConfig = null;
        this.allCharacterConfigs = null; // 存储所有角色的配置
        this.currentCharacter = null; // 当前角色名称
        this.isPlayingMotion = false;
        this.motionInterval = 2000;

        this.loadEmotionConfig();
    }

    async loadEmotionConfig() {
        try {
            const response = await fetch('emotion_actions.json');

            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.allCharacterConfigs = data;

            // 获取当前角色名称
            this.currentCharacter = await this.getCurrentCharacterName();

            // 加载对应角色的配置
            if (this.currentCharacter && data[this.currentCharacter]) {
                this.emotionConfig = data[this.currentCharacter].emotion_actions;
                console.log(`成功加载角色 "${this.currentCharacter}" 的情绪配置，可用情绪:`, Object.keys(this.emotionConfig));
            } else {
                console.warn(`未找到角色 "${this.currentCharacter}" 的配置，使用空配置`);
                this.emotionConfig = this.createDefaultEmotionConfig();

                // 如果是新角色，自动创建默认配置
                if (this.currentCharacter) {
                    await this.createCharacterConfig(this.currentCharacter);
                }
            }

        } catch (error) {
            console.error('情绪配置文件加载失败:', error.message);
            this.emotionConfig = this.createDefaultEmotionConfig();
        }
    }

    // 获取当前角色名称的多种方法
    async getCurrentCharacterName() {
        try {
            // 从模型路径提取角色名
            if (this.model && this.model.internalModel && this.model.internalModel.settings) {
                const modelPath = this.model.internalModel.settings.url || '';
                console.log('模型路径:', modelPath);

                // 从 "2D/肥牛/xxx.model3.json" 提取 "肥牛"
                const match = modelPath.match(/2D\/([^\/]+)\//);
                if (match) {
                    const characterName = match[1];
                    console.log('从路径提取角色名:', characterName);
                    return characterName;
                }
            }

            return "肥牛";
        } catch (error) {
            console.error('获取角色名失败:', error);
            return "肥牛";
        }
    }

    // 从模型路径中提取角色名称
    extractCharacterFromPath(modelPath) {
        try {
            // 假设路径格式类似: "2D/肥牛/hiyori_pro_mic.model3.json"
            const pathParts = modelPath.split('/');
            if (pathParts.length >= 2 && pathParts[0] === '2D') {
                return pathParts[1]; // 返回角色文件夹名称
            }

            // 备选方案：从文件名推断
            const fileName = pathParts[pathParts.length - 1];
            if (fileName && fileName.includes('hiyori')) {
                return "肥牛";
            }
            if (fileName && fileName.includes('mgirl')) {
                return "橘色女生";
            }

            return null;
        } catch (error) {
            console.error('从路径提取角色名称失败:', error);
            return null;
        }
    }

    // 创建默认情绪配置
    createDefaultEmotionConfig() {
        return {
            "开心": [],
            "生气": [],
            "难过": [],
            "惊讶": [],
            "害羞": [],
            "俏皮": []
        };
    }

    // 为新角色创建配置并保存
    async createCharacterConfig(characterName) {
        try {
            if (!this.allCharacterConfigs) {
                this.allCharacterConfigs = {};
            }

            // 创建新角色的默认配置
            this.allCharacterConfigs[characterName] = {
                "emotion_actions": this.createDefaultEmotionConfig()
            };

            // 尝试通过HTTP请求保存配置（需要后端支持）
            await this.saveConfigToFile();

            console.log(`已为角色 "${characterName}" 创建默认配置`);
        } catch (error) {
            console.error(`为角色 "${characterName}" 创建配置失败:`, error);
        }
    }

    // 保存配置到文件（需要后端API支持）
    async saveConfigToFile() {
        try {
            // 这里需要一个后端API来保存文件
            // 可以通过main.js中的IPC或HTTP接口实现
            const response = await fetch('/api/save-emotion-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.allCharacterConfigs)
            });

            if (!response.ok) {
                throw new Error('保存配置失败');
            }

            console.log('情绪配置已成功保存');
        } catch (error) {
            console.error('保存配置到文件失败:', error);

            // 备选方案：保存到localStorage作为临时存储
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('emotionConfigs', JSON.stringify(this.allCharacterConfigs));
                console.log('配置已保存到本地存储');
            }
        }
    }

    // 切换角色配置
    async switchCharacter(newCharacterName) {
        try {
            if (!this.allCharacterConfigs || !this.allCharacterConfigs[newCharacterName]) {
                console.warn(`角色 "${newCharacterName}" 的配置不存在，创建默认配置`);
                await this.createCharacterConfig(newCharacterName);
            }

            this.currentCharacter = newCharacterName;
            this.emotionConfig = this.allCharacterConfigs[newCharacterName].emotion_actions;

            // 保存用户选择的角色
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('selectedCharacter', newCharacterName);
            }

            console.log(`已切换到角色 "${newCharacterName}"，可用情绪:`, Object.keys(this.emotionConfig));

            // 触发配置更新事件（如果需要通知其他组件）
            if (typeof window !== 'undefined' && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('characterConfigChanged', {
                    detail: { character: newCharacterName, config: this.emotionConfig }
                }));
            }

            return true;
        } catch (error) {
            console.error(`切换到角色 "${newCharacterName}" 失败:`, error);
            return false;
        }
    }

    // 获取所有可用角色列表
    getAvailableCharacters() {
        if (!this.allCharacterConfigs) {
            return [];
        }
        return Object.keys(this.allCharacterConfigs);
    }

    // 获取当前角色信息
    getCurrentCharacterInfo() {
        return {
            name: this.currentCharacter,
            config: this.emotionConfig,
            availableEmotions: this.emotionConfig ? Object.keys(this.emotionConfig) : []
        };
    }

    // 添加新情绪到当前角色
    addEmotionToCurrentCharacter(emotionName, motionFiles = []) {
        if (!this.emotionConfig) {
            console.error('当前没有加载任何角色配置');
            return false;
        }

        this.emotionConfig[emotionName] = motionFiles;

        // 同步更新到全配置中
        if (this.allCharacterConfigs && this.currentCharacter) {
            this.allCharacterConfigs[this.currentCharacter].emotion_actions[emotionName] = motionFiles;
        }

        console.log(`已为角色 "${this.currentCharacter}" 添加情绪 "${emotionName}"`);
        return true;
    }

    // 从当前角色移除情绪
    removeEmotionFromCurrentCharacter(emotionName) {
        if (!this.emotionConfig || !this.emotionConfig[emotionName]) {
            console.error(`情绪 "${emotionName}" 不存在于当前角色配置中`);
            return false;
        }

        delete this.emotionConfig[emotionName];

        // 同步更新到全配置中
        if (this.allCharacterConfigs && this.currentCharacter) {
            delete this.allCharacterConfigs[this.currentCharacter].emotion_actions[emotionName];
        }

        console.log(`已从角色 "${this.currentCharacter}" 移除情绪 "${emotionName}"`);
        return true;
    }

    // 解析情绪标签
    parseEmotionTagsWithPosition(text) {
        const pattern = /<([^>]+)>/g;
        const emotions = [];
        let match;

        while ((match = pattern.exec(text)) !== null) {
            emotions.push({
                emotion: match[1],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                fullTag: match[0]
            });
        }

        return emotions;
    }

    // 预处理文本
    prepareTextForTTS(text) {
        const emotionTags = this.parseEmotionTagsWithPosition(text);

        if (emotionTags.length === 0) {
            return { text: text, emotionMarkers: [] };
        }

        // 移除标签
        let purifiedText = text;
        for (let i = emotionTags.length - 1; i >= 0; i--) {
            const tag = emotionTags[i];
            purifiedText = purifiedText.substring(0, tag.startIndex) +
                           purifiedText.substring(tag.endIndex);
        }

        // 创建标记
        const emotionMarkers = [];
        let offset = 0;

        for (const tag of emotionTags) {
            const adjustedPosition = tag.startIndex - offset;
            offset += tag.endIndex - tag.startIndex;

            if (this.emotionConfig && this.emotionConfig[tag.emotion]) {
                emotionMarkers.push({
                    position: adjustedPosition,
                    emotion: tag.emotion,
                    motionFiles: this.emotionConfig[tag.emotion]
                });
            } else {
                console.warn(`当前角色 "${this.currentCharacter}" 没有配置情绪 "${tag.emotion}"`);
            }
        }

        return {
            text: purifiedText,
            emotionMarkers: emotionMarkers
        };
    }

    // 位置触发
    triggerEmotionByTextPosition(position, textLength, emotionMarkers) {
        if (!emotionMarkers || emotionMarkers.length === 0) return;

        // 检查常规位置触发
        for (let i = emotionMarkers.length - 1; i >= 0; i--) {
            const marker = emotionMarkers[i];
            if (position >= marker.position && position <= marker.position + 2) {
                this.playConfiguredEmotion(marker.emotion);
                emotionMarkers.splice(i, 1);
                break;
            }
        }

        // 如果到达文本末尾，强制触发所有剩余的情绪标记
        if (position >= textLength - 1 && emotionMarkers.length > 0) {
            for (const marker of emotionMarkers) {
                this.playConfiguredEmotion(marker.emotion);
            }
            emotionMarkers.length = 0;
        }
    }

    // 兼容方法
    triggerMotionByEmotion(text) {
        const match = text.match(/<([^>]+)>/);
        if (match && match[1]) {
            const emotion = match[1];
            this.playConfiguredEmotion(emotion);
        }

        return text.replace(/<[^>]+>/g, '').trim();
    }

    // 播放配置的情绪动作
    playConfiguredEmotion(emotion) {
        if (!this.emotionConfig || !this.emotionConfig[emotion]) {
            console.warn(`角色 "${this.currentCharacter}" 没有配置情绪 "${emotion}"`);
            return;
        }

        const motionFiles = this.emotionConfig[emotion];
        if (!motionFiles || motionFiles.length === 0) {
            console.warn(`角色 "${this.currentCharacter}" 的情绪 "${emotion}" 没有配置动作文件`);
            return;
        }

        // 随机选择
        const selectedFile = motionFiles[Math.floor(Math.random() * motionFiles.length)];

        // 查找索引
        const motionIndex = this.findMotionIndexByFileName(selectedFile);
        if (motionIndex !== -1) {
            this.playMotion(motionIndex);
            console.log(`播放角色 "${this.currentCharacter}" 的情绪动作: ${emotion} -> ${selectedFile}`);
        } else {
            console.error(`未找到动作文件 "${selectedFile}" 对应的索引`);
        }
    }

    // 根据文件名查找索引
    findMotionIndexByFileName(fileName) {
        try {
            const motionDefinitions = this.model.internalModel.settings.motions[this.currentMotionGroup];
            if (!motionDefinitions) {
                console.error(`未找到动作组 "${this.currentMotionGroup}"`);
                return -1;
            }

            return motionDefinitions.findIndex(motion => motion.File === fileName);
        } catch (error) {
            console.error('查找动作索引失败:', error);
            return -1;
        }
    }

    // 播放动作
    playMotion(index) {
        if (!this.model) {
            console.error('模型未初始化');
            return;
        }

        try {
            const motionDefinitions = this.model.internalModel.settings.motions[this.currentMotionGroup];
            if (!motionDefinitions || motionDefinitions.length === 0) {
                console.error(`动作组 "${this.currentMotionGroup}" 为空或不存在`);
                return;
            }

            const motionIndex = index % motionDefinitions.length;

            // 停止当前动作
            if (this.model.internalModel && this.model.internalModel.motionManager) {
                this.model.internalModel.motionManager.stopAllMotions();
            }

            // 播放新动作
            this.model.motion(this.currentMotionGroup, motionIndex);
            console.log(`播放动作索引 ${motionIndex}，动作文件: ${motionDefinitions[motionIndex].File}`);
        } catch (error) {
            console.error('播放动作失败:', error);
        }
    }

    // 播放默认动作
    playDefaultMotion() {
        try {
            if (this.model.internalModel.settings.motions["Idle"]) {
                this.model.motion("Idle", 0);
                console.log('播放默认Idle动作');
            } else {
                this.model.motion(this.currentMotionGroup, 0);
                console.log(`播放默认 ${this.currentMotionGroup} 动作`);
            }
        } catch (error) {
            console.error('播放默认动作失败:', error);
        }
    }

    // 重新加载配置（用于外部配置更新后刷新）
    async reloadConfig() {
        console.log('重新加载情绪配置...');
        await this.loadEmotionConfig();
    }
}

module.exports = { EmotionMotionMapper };