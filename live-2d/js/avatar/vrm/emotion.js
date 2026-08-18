// emotion.js - VRM 情绪/表情映射器（v2，由 js/model/vrm-model-setup.js 的静态工厂迁移）
// 契约与 Live2D 的双门面一致：prepareTextForTTS / triggerEmotionByTextPosition /
// playConfiguredEmotion / triggerExpressionByEmotion / triggerExpression。
// 中文情绪 -> VRM preset 表情映射可被模型目录下的 emotion_mapping.json 覆盖（可选）。

function getCharacterName(modelPath) {
    const match = String(modelPath || '').match(/3D\/(?:.*\/)?([^\/]+?)\.vrm$/i);
    if (match) return match[1];
    return 'VRM角色';
}

function parseEmotionTagsWithPosition(text) {
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

function prepareTextForTTS(text) {
    const emotionTags = parseEmotionTagsWithPosition(text);
    if (emotionTags.length === 0) {
        return { text, emotionMarkers: [] };
    }
    let purifiedText = text;
    for (let i = emotionTags.length - 1; i >= 0; i--) {
        const tag = emotionTags[i];
        purifiedText = purifiedText.substring(0, tag.startIndex) + purifiedText.substring(tag.endIndex);
    }
    const emotionMarkers = [];
    let offset = 0;
    for (const tag of emotionTags) {
        emotionMarkers.push({ position: tag.startIndex - offset, emotion: tag.emotion });
        offset += tag.endIndex - tag.startIndex;
    }
    return { text: purifiedText, emotionMarkers };
}

function createVRMEmotionMapper(model, expressionMap) {
    return {
        model,
        currentMotionGroup: 'TapBody',
        emotionConfig: expressionMap,
        isPlayingMotion: false,
        currentCharacter: getCharacterName(model._modelPath),

        async getCurrentCharacterName() {
            return getCharacterName(model._modelPath);
        },
        prepareTextForTTS(text) {
            return prepareTextForTTS(text);
        },
        triggerEmotionByTextPosition(position, textLength, emotionMarkers) {
            if (!emotionMarkers || emotionMarkers.length === 0) return;
            for (let i = emotionMarkers.length - 1; i >= 0; i--) {
                const marker = emotionMarkers[i];
                if (position >= marker.position && position <= marker.position + 2) {
                    this.playConfiguredEmotion(marker.emotion);
                    emotionMarkers.splice(i, 1);
                    break;
                }
            }
            if (position >= textLength - 1 && emotionMarkers.length > 0) {
                for (const marker of emotionMarkers) this.playConfiguredEmotion(marker.emotion);
                emotionMarkers.length = 0;
            }
        },
        playConfiguredEmotion(emotion) {
            if (expressionMap[emotion]) {
                model.playEmotionExpression(emotion);
            } else {
                console.warn(`VRM未配置情绪: ${emotion}`);
            }
        },
        parseEmotionTagsWithPosition,
        playMotionByEmotion(emotion) {
            this.playConfiguredEmotion(emotion);
        },
        playMotion(group) {
            model.motion(typeof group === 'number' ? 'TapBody' : group);
        },
        playDefaultMotion() { /* VRM 无 idle motion 语义（由 Idle 姿态动画承担） */ },
        getEmotionList() {
            return Object.keys(expressionMap);
        },
        getEmotionConfig() {
            const config = {};
            for (const [emotion, vrmName] of Object.entries(expressionMap)) {
                config[emotion] = [`vrm_expression:${vrmName}`];
            }
            return config;
        },
        async loadEmotionConfig() {},
        async reloadConfig() {},
        triggerMotionByEmotion(text) {
            const match = text.match(/<([^>]+)>/);
            if (match && match[1]) this.playConfiguredEmotion(match[1]);
            return text.replace(/<[^>]+>/g, '').trim();
        },
        setEmotionCallback(callback) {
            this._emotionCallback = callback;
        }
    };
}

function createVRMExpressionMapper(model, expressionMap) {
    return {
        model,
        defaultExpression: 'neutral',
        expressionConfig: expressionMap,
        currentCharacter: getCharacterName(model._modelPath),

        async getCurrentCharacterName() {
            return getCharacterName(model._modelPath);
        },
        setEmotionMapper() {},
        prepareTextForTTS(text) {
            return prepareTextForTTS(text);
        },
        triggerExpressionByEmotion(emotion) {
            if (expressionMap[emotion]) {
                model.playEmotionExpression(emotion);
                return expressionMap[emotion];
            }
            return null;
        },
        triggerEmotionByTextPosition(position, textLength, expressionMarkers) {
            if (!expressionMarkers || expressionMarkers.length === 0) return;
            for (let i = expressionMarkers.length - 1; i >= 0; i--) {
                const marker = expressionMarkers[i];
                if (position >= marker.position && position <= marker.position + 2) {
                    this.triggerExpressionByEmotion(marker.emotion);
                    expressionMarkers.splice(i, 1);
                    break;
                }
            }
            if (position >= textLength - 1 && expressionMarkers.length > 0) {
                for (const marker of expressionMarkers) this.triggerExpressionByEmotion(marker.emotion);
                expressionMarkers.length = 0;
            }
        },
        triggerExpression(expressionName) {
            if (!expressionName || expressionName === 'neutral' || expressionName === this.defaultExpression) {
                model._playExpression('neutral', 2000);
                return true;
            }
            if (expressionMap[expressionName]) {
                model.playEmotionExpression(expressionName);
                return true;
            }
            // 直接透传 VRM preset 名（happy/angry/...）
            model._playExpression(expressionName, 3000);
            return true;
        },
        playExpression(name) {
            return this.triggerExpression(name);
        },
        playDefaultExpression() {
            model._playExpression('neutral', 2000);
            return true;
        },
        bindExpressionToEmotion() {
            console.warn('[VRM] bindExpressionToEmotion 不适用于 VRM 形态');
            return false;
        },
        async reloadConfig() {}
    };
}

module.exports = { createVRMEmotionMapper, createVRMExpressionMapper, getCharacterName, prepareTextForTTS, parseEmotionTagsWithPosition };
