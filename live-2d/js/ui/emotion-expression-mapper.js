// emotion-expression-mapper.js - 情绪表情映射器
const { eventBus } = require('../core/event-bus.js');
const { Events } = require('../core/events.js');

class EmotionExpressionMapper {
    constructor(model) {
        this.model = model;
        this.currentExpressionGroup = "TapBody";
        this.expressionConfig = null;
        this.allCharacterConfigs = null;
        this.currentCharacter = null;
        this.emotionMapper = null; // 引用情绪动作映射器
        this.defaultExpression = "表情1"; // 默认表情
        
        this.loadExpressionConfig();
    }
    
    // 设置情绪映射器引用
    setEmotionMapper(emotionMapper) {
        this.emotionMapper = emotionMapper;
        console.log('表情映射器已连接情绪映射器');
    }
    
    async loadExpressionConfig() {
        try {
            const response = await fetch('emotion_expressions.json');
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
                
            }
            
            const data = await response.json();
            this.allCharacterConfigs = data;
            
            // 获取当前角色名称
            this.currentCharacter = await this.getCurrentCharacterName();
            
            if (this.currentCharacter && data[this.currentCharacter]) {
                this.expressionConfig = data[this.currentCharacter].emotion_expressions;
                console.log(`成功加载角色 "${this.currentCharacter}" 的表情配置，可用情绪:`, Object.keys(this.expressionConfig));
                
            } else {
                console.warn(`未找到角色 "${this.currentCharacter}" 的表情配置`);
                this.expressionConfig = this.createDefaultExpressionConfig();
            

                // 如果是新角色，自动创建默认配置
                if (this.currentCharacter) {
                    await this.createCharacterConfig(this.currentCharacter);
                }
            }    
        
        } catch (error) {
            console.error('表情配置文件加载失败:', error.message);
            this.expressionConfig = this.createDefaultExpressionConfig();
        }
    }
    
    createDefaultExpressionConfig() {
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
            await this.saveExpressionConfig();

            console.log(`已为角色 "${characterName}" 创建默认配置`);
        } catch (error) {
            console.error(`为角色 "${characterName}" 创建配置失败:`, error);
        }
    }
    
    
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
                
    
    // 绑定表情到情绪（关键修改：直接保存到emotion_expressions.json）
    bindExpressionToEmotion(emotion, expressionName) {
        console.log(`尝试绑定表情 ${expressionName} 到情绪 ${emotion}`);
        
        if (!this.expressionConfig) {
            console.error('表情配置未加载');
            return false;
        }
        
        // 检查表情是否存在
        if (!this.expressionConfig[expressionName]) {
            console.warn(`表情 "${expressionName}" 不存在于配置中`);
            // 尝试查找对应的表情文件
            const expressionFile = this.findExpressionFile(expressionName);
            if (!expressionFile) {
                console.error(`未找到表情 "${expressionName}" 对应的文件`);
                return false;
            }
            // 将表情添加到配置中
            this.expressionConfig[expressionName] = [expressionFile];
            console.log(`添加表情配置: ${expressionName} -> ${expressionFile}`);
        }
        
        // 获取表情文件路径
        const expressionFiles = this.expressionConfig[expressionName];
        if (!expressionFiles || expressionFiles.length === 0) {
            console.error(`表情 "${expressionName}" 没有配置文件`);
            return false;
        }
        
        // 检查情绪是否已存在
        if (!this.expressionConfig[emotion]) {
            this.expressionConfig[emotion] = [];
        }
        
        // 避免重复添加相同的表情文件
        for (const exprFile of expressionFiles) {
            if (!this.expressionConfig[emotion].includes(exprFile)) {
                this.expressionConfig[emotion].push(exprFile);
                console.log(`将表情文件 ${exprFile} 添加到情绪 ${emotion}`);
            } else {
                console.log(`表情文件 ${exprFile} 已存在于情绪 ${emotion}`);
            }
        }
        
        // 保存配置到文件
        this.saveExpressionConfig();
        
        console.log(`已将表情 "${expressionName}" 绑定到情绪 "${emotion}"`);
        
        // 发送事件通知
        eventBus.emit(Events.EXPRESSION_BOUND, { 
            emotion, 
            expression: expressionName,
            files: expressionFiles 
        });
        
        return true;
    }
    
    // 查找表情文件路径
    findExpressionFile(expressionName) {
        // 尝试不同的命名格式
        const possibleNames = [
            expressionName,
            expressionName.replace('表情', 'expression'),
            expressionName.replace('Expression', 'expression')
        ];
        
        for (const name of possibleNames) {
            if (this.expressionConfig && this.expressionConfig[name]) {
                const files = this.expressionConfig[name];
                if (files && files.length > 0) {
                    return files[0];
                }
            }
        }
        
        // 尝试从文件路径推断
        const expressionFile = `expressions/${expressionName}.exp3.json`;
        if (expressionFile.includes('expression')) {
            return expressionFile;
        }
        
        return null;
    }
    
    // 保存表情配置到文件
    async saveExpressionConfig() {
        try {
            // 更新所有角色的配置
            if (!this.allCharacterConfigs) {
                this.allCharacterConfigs = {};
            }
            
            if (this.currentCharacter) {
                if (!this.allCharacterConfigs[this.currentCharacter]) {
                    this.allCharacterConfigs[this.currentCharacter] = {
                        emotion_expressions: {}
                    };
                }
                
                // 确保只保存当前角色的配置
                this.allCharacterConfigs[this.currentCharacter].emotion_expressions = this.expressionConfig;
                
                console.log(`保存角色 "${this.currentCharacter}" 的表情配置`);
                console.log('情绪表情绑定:', {
                    "开心": this.expressionConfig["开心"]?.length || 0,
                    "生气": this.expressionConfig["生气"]?.length || 0,
                    "难过": this.expressionConfig["难过"]?.length || 0,
                    "惊讶": this.expressionConfig["惊讶"]?.length || 0,
                    "害羞": this.expressionConfig["害羞"]?.length || 0,
                    "俏皮": this.expressionConfig["俏皮"]?.length || 0
                });
            }
            
            // 尝试通过HTTP请求保存配置（需要后端支持）
            const response = await fetch('/api/save-expression-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.allCharacterConfigs)
            });
            
            if (response.ok) {
                console.log('表情配置已成功保存到服务器');
            } else {
                console.warn('服务器保存失败，尝试保存到本地存储');
                // 备选方案：保存到localStorage作为临时存储
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('expressionConfigs', JSON.stringify(this.allCharacterConfigs));
                    console.log('配置已保存到本地存储');
                }
            }
            
        } catch (error) {
            console.error('保存表情配置失败:', error);
            // 备选方案：保存到localStorage作为临时存储
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('expressionConfigs', JSON.stringify(this.allCharacterConfigs));
                console.log('配置已保存到本地存储（因错误回退）');
            }
        }
    }
    
    // 关键功能：根据情绪标签切换表情
    triggerExpressionByEmotion(emotion) {
        console.log(`触发情绪表情: ${emotion}`);
        
        if (!this.expressionConfig) {
            console.warn('表情配置未加载');
            this.playDefaultExpression();
            return null;
        }
        
        // 1. 检查配置文件中是否有对应情绪的表情文件
        if (this.expressionConfig[emotion] && this.expressionConfig[emotion].length > 0) {
            const expressionFiles = this.expressionConfig[emotion];
            // 随机选择一个表情文件
            const selectedFile = expressionFiles[Math.floor(Math.random() * expressionFiles.length)];
            const expressionName = this.extractExpressionNameFromPath(selectedFile);
            
            this.playExpressionFile(selectedFile);
            console.log(`播放情绪表情: ${emotion} -> ${expressionName} (${selectedFile})`);
            
            eventBus.emit(Events.EXPRESSION_TRIGGERED, { 
                emotion, 
                expression: expressionName,
                file: selectedFile 
            });
            return expressionName;
        }
        
        // 2. 都没有则播放默认表情
        console.log(`情绪 ${emotion} 没有绑定表情文件，播放默认表情`);
        this.playDefaultExpression();
        return null;
    }
    
    // 从文件路径提取表情名称
    extractExpressionNameFromPath(expressionFile) {
        try {
            const fileName = expressionFile.split('/').pop();
            let expressionName = fileName.replace('.exp3.json', '');
            
            // 转换为中文显示名称
            if (expressionName.startsWith("expression")) {
                const num = expressionName.replace("expression", "");
                if (!isNaN(parseInt(num))) {
                    expressionName = `表情${num}`;
                }
            }
            
            return expressionName;
        } catch (e) {
            console.warn('提取表情名称失败:', e);
            return '未知表情';
        }
    }
    
    // 播放默认表情（从expression-mapper.js合并）
    playDefaultExpression() {
        console.log('播放默认表情');

        // 首先尝试使用 this.defaultExpression 指定的默认表情
        if (this.defaultExpression && this.expressionConfig && this.expressionConfig[this.defaultExpression]) {
            const defaultFiles = this.expressionConfig[this.defaultExpression];
            if (defaultFiles && defaultFiles.length > 0) {
                this.playExpressionFile(defaultFiles[0]);
                console.log(`播放 ${this.defaultExpression} 作为默认表情`);
                return;
            }
        }
        
        // 尝试表情1
        if (this.expressionConfig && this.expressionConfig["表情1"]) {
            const defaultFiles = this.expressionConfig["表情1"];
            if (defaultFiles && defaultFiles.length > 0) {
                this.playExpressionFile(defaultFiles[0]);
                console.log('播放表情1作为默认表情');
                return;
            }
        }
        
        // 其次尝试默认表情
        if (this.expressionConfig && this.expressionConfig["默认表情"]) {
            const defaultFiles = this.expressionConfig["默认表情"];
            if (defaultFiles && defaultFiles.length > 0) {
                this.playExpressionFile(defaultFiles[0]);
                console.log('播放默认表情');
                return;
            }
        }
        
        // 最后尝试第一个可用的表情按钮
        if (this.expressionConfig) {
            for (const [name, files] of Object.entries(this.expressionConfig)) {
                // 跳过情绪分类和空的表情
                if (files && files.length > 0 && 
                    name !== "开心" && name !== "生气" && name !== "难过" && 
                    name !== "惊讶" && name !== "害羞" && name !== "俏皮" &&
                    !name.startsWith("表情")) {
                    this.playExpressionFile(files[0]);
                    console.log(`播放 ${name} 作为默认表情`);
                    return;
                }
            }
        }
        
        console.warn('没有可用的默认表情');
    }
    
    // 直接触发表情（从expression-mapper.js合并）
    triggerExpression(expressionName) {
        if (!this.expressionConfig) {
            console.warn('表情配置未加载');
            this.playDefaultExpression();
            return false;
        }
        
        // 如果请求的是默认表情，直接播放
        if (expressionName === "默认表情" || expressionName === this.defaultExpression) {
            this.playDefaultExpression();
            return true;
        }
        
        if (!this.expressionConfig[expressionName]) {
            console.warn(`表情 "${expressionName}" 未配置，使用默认表情`);
            this.playDefaultExpression();
            return false;
        }
        
        const expressionFiles = this.expressionConfig[expressionName];
        if (!expressionFiles || expressionFiles.length === 0) {
            console.warn(`表情 "${expressionName}" 没有配置文件，使用默认表情`);
            this.playDefaultExpression();
            return false;
        }
        
        // 随机选择一个表情文件
        const selectedFile = expressionFiles[Math.floor(Math.random() * expressionFiles.length)];
        
        // 播放表情
        this.playExpressionFile(selectedFile);
        console.log(`播放表情: ${expressionName} -> ${selectedFile}`);
        
        // 发送事件通知
        eventBus.emit(Events.EXPRESSION_PLAYED, { 
            expression: expressionName, 
            file: selectedFile 
        });
        
        return true;
    }
    
    // 播放表情文件
    playExpressionFile(expressionFile) {
        if (!this.model) {
            console.error('模型未初始化');
            return false;
        }
        
        try {
            let expressionName = expressionFile.split('/').pop().replace('.exp3.json', '');
            
            // 转换为表情名称格式
            if (expressionName.startsWith("expression")) {
                const num = expressionName.replace("expression", "");
                if (!isNaN(parseInt(num))) {
                    expressionName = `表情${num}`;
                }
            }
            
            if (this.model.expression) {
                // 注意：Live2D模型需要原始表情文件名，不是显示名称
                const originalExpressionName = expressionFile.split('/').pop().replace('.exp3.json', '');
                this.model.expression(originalExpressionName);
                console.log(`播放表情文件: ${expressionName} (原始: ${originalExpressionName})`);
                return true;
            } else {
                console.error('模型不支持表情播放');
                return false;
            }
        } catch (error) {
            console.error('播放表情失败:', error);
            return false;
        }
    }
    
    // 兼容方法：直接播放表情（别名）
    playExpression(expressionName) {
        return this.triggerExpression(expressionName);
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


    //  prepareTextForTTS 方法
    prepareTextForTTS(text) {
        // 复刻情绪映射器的逻辑，但用于表情
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
        
        // 创建表情标记器
        const emotionMarkers = [];
        let offset = 0;
        
        for (const tag of emotionTags) {
            const adjustedPosition = tag.startIndex - offset;
            offset += tag.endIndex - tag.startIndex;
            
            // 检查当前角色是否有该情绪的表情配置
            if (this.expressionConfig && this.expressionConfig[tag.emotion]) {
                emotionMarkers.push({
                    position: adjustedPosition,
                    emotion: tag.emotion,
                    expressionFiles: this.expressionConfig[tag.emotion]
                });
            } else {
                console.warn(`当前角色 "${this.currentCharacter}" 没有配置表情 "${tag.emotion}"`);
            }
        }
        
        return {
            text: purifiedText,
            emotionMarkers: emotionMarkers
        };
    }

    //  triggerEmotionByTextPosition 方法
    triggerEmotionByTextPosition(position, textLength, expressionMarkers) {
        if (!expressionMarkers || expressionMarkers.length === 0) return;
        
        // 检查常规位置触发
        for (let i = expressionMarkers.length - 1; i >= 0; i--) {
            const marker = expressionMarkers[i];
            if (position >= marker.position && position <= marker.position + 2) {
                // 触发表情
                this.triggerExpressionByEmotion(marker.emotion);
                expressionMarkers.splice(i, 1);
                break;
            }
        }
        
        // 如果到达文本末尾，强制触发所有剩余的表情标记
        if (position >= textLength - 1 && expressionMarkers.length > 0) {
            for (const marker of expressionMarkers) {
                this.triggerExpressionByEmotion(marker.emotion);
            }
            expressionMarkers.length = 0;
        }
    }


    playConfiguredEmotion(emotion) {
        if (!this.emotionConfig || !this.emotionConfig[emotion]) {
            console.warn(`角色 "${this.currentCharacter}" 没有配置情绪 "${emotion}"`);
            return;
        }
    
        const expressionFiles = this.emotionConfig[emotion];
        if (!expressionFiles || expressionFiles.length === 0) {
            console.warn(`角色 "${this.currentCharacter}" 的情绪 "${emotion}" 没有配置动作文件`);
            return;
        }
    
        // 随机选择
        const selectedFile = expressionFiles[Math.floor(Math.random() * expressionFiles.length)];
    
        // 查找索引
        const expressionIndex = this.findExpressionIndexByFileName(selectedFile);
        if (expressionIndex !== -1) {
            setTimeout(() => {
                const triggeredExpression = global.expressionMapper.triggerExpressionByEmotion(emotion);
                if (triggeredExpression) {
                    console.log(`播放角色 "${this.currentCharacter}" 的情绪动作: ${emotion} -> ${selectedFile}`);
                }
            }, 100);
            
        } else {
            console.error(`未找到表情文件 "${selectedFile}" 对应的索引`);
        }
    }

    // 根据文件名查找索引
    findExpressionIndexByFileName(fileName) {
        try {
            const ExpressionDefinitions = this.model.internalModel.settings.Expressions[this.currentExpressionGroup];
            if (!ExpressionDefinitions) {
                console.error(`未找到动作组 "${this.currentExpressionGroup}"`);
                return -1;
            }

            return ExpressionDefinitions.findIndex(Expression => Expression.File === fileName);
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
    
    // 解析情绪标签中的表情（从expression-mapper.js合并）
    parseExpressionTags(text) {
        const pattern = /<expression:([^>]+)>/g;
        const expressions = [];
        let match;
        
        while ((match = pattern.exec(text)) !== null) {
            expressions.push(match[1]);
        }
        
        return expressions;
    }
    
    // 处理文本中的表情标签（从expression-mapper.js合并）
    processTextWithExpressions(text) {
        const expressions = this.parseExpressionTags(text);
        let cleanedText = text;
        
        // 移除表情标签
        for (const expr of expressions) {
            cleanedText = cleanedText.replace(`<expression:${expr}>`, '');
            // 触发表情
            this.triggerExpression(expr);
        }
        
        return cleanedText.trim();
    }
    
    // 获取情绪的表情绑定信息
    getEmotionBindings(emotion) {
        if (!this.expressionConfig || !this.expressionConfig[emotion]) {
            return [];
        }
        
        const expressionFiles = this.expressionConfig[emotion];
        const bindings = [];
        
        for (const file of expressionFiles) {
            const expressionName = this.extractExpressionNameFromPath(file);
            bindings.push({
                file: file,
                name: expressionName
            });
        }
        
        return bindings;
    }
    
    // 获取所有表情绑定
    getAllEmotionBindings() {
        const emotions = ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"];
        const bindings = {};
        
        for (const emotion of emotions) {
            bindings[emotion] = this.getEmotionBindings(emotion);
        }
        
        return bindings;
    }
    
    // 重新加载配置
    async reloadConfig() {
        console.log('重新加载表情配置...');
        await this.loadExpressionConfig();
    }
    
    // 从情绪中移除表情绑定
    removeExpressionFromEmotion(emotion, expressionName) {
        if (!this.expressionConfig || !this.expressionConfig[emotion]) {
            console.warn(`情绪 "${emotion}" 没有绑定任何表情`);
            return false;
        }
        
        const expressionFiles = this.expressionConfig[emotion];
        const expressionFileToRemove = `expressions/${expressionName}.exp3.json`;
        
        // 查找要移除的表情文件
        const index = expressionFiles.findIndex(file => 
            file === expressionFileToRemove || 
            file.includes(expressionName)
        );
        
        if (index !== -1) {
            expressionFiles.splice(index, 1);
            console.log(`从情绪 "${emotion}" 中移除表情: ${expressionName}`);
            
            // 保存配置
            this.saveExpressionConfig();
            
            eventBus.emit(Events.EXPRESSION_UNBOUND, { 
                emotion, 
                expression: expressionName 
            });
            
            return true;
        }
        
        console.warn(`情绪 "${emotion}" 中没有找到表情 "${expressionName}"`);
        return false;
    }
}

module.exports = { EmotionExpressionMapper };