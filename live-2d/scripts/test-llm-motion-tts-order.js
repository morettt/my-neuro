'use strict';

const assert = require('assert');
const { LLMHandler } = require('../js/ai/llm-handler.js');
const { LLMClient } = require('../js/ai/llm-client.js');
const { motionDirector } = require('../js/ai/motion-director.js');

async function testDirectorWaitsForChoreographyBeforeTts() {
    const config = {
        llm: {
            api_url: 'https://dialogue.example/v1',
            api_key: 'main-key',
            model: 'main-model'
        },
        tts: { enabled: true },
        ui: {
            avatar_motion_mode: 'director',
            text_only_mode: false
        },
        motion_director: {
            enabled: true,
            wait_before_tts: true,
            first_frame_wait_ms: 1000
        }
    };
    const events = [];
    const originalChatCompletion = LLMClient.prototype.chatCompletion;
    const originalChoreograph = motionDirector.choreograph;
    const originalParamDirector = global.paramDirector;
    global.paramDirector = {
        cancel() {},
        prepareSpeech() {},
        noteSpeechProgress() {},
        getParamCatalog: () => []
    };
    const voiceChat = {
        messages: [],
        enableContextLimit: false,
        shouldTakeScreenshot: async () => false,
        saveConversationHistory() {
            events.push('history-saved');
        },
        removeInjectedMemory() {}
    };
    const ttsProcessor = {
        reset() {
            events.push('tts-reset');
        },
        processTextToSpeech(text) {
            events.push(`tts:${text}`);
        }
    };

    LLMClient.prototype.chatCompletion = async (_messages, _tools, stream, onChunk) => {
        assert.strictEqual(stream, true);
        assert.strictEqual(typeof onChunk, 'function');
        onChunk('流式片段不应提前进入TTS');
        events.push('main-response');
        return { content: '<开心>最终回复', tool_calls: [] };
    };

    motionDirector.choreograph = (text, receivedConfig, extras) => {
        assert.strictEqual(text, '<开心>最终回复');
        assert.strictEqual(receivedConfig, config);
        assert.strictEqual(extras.userMessage, '用户请求');
        events.push('choreography-start');
        const work = Promise.resolve({ accepted: 2 });
        work.firstFrameLoaded = Promise.resolve({ source: 'fallback' });
        return work;
    };

    try {
        const sendToLLM = LLMHandler.createEnhancedSendToLLM(
            voiceChat,
            ttsProcessor,
            false,
            config
        );
        await sendToLLM('用户请求');
        assert.deepStrictEqual(events, [
            'tts-reset',
            'main-response',
            'history-saved',
            'choreography-start',
            'tts-reset',
            'tts:<开心>最终回复'
        ]);
        assert.ok(
            events.indexOf('choreography-start') <
            events.indexOf('tts:<开心>最终回复'),
            'choreography must start before final TTS playback'
        );
        assert.strictEqual(
            events.some(event => event.includes('流式片段')),
            false,
            'choreography mode must not send the early stream chunk to TTS'
        );
    } finally {
        LLMClient.prototype.chatCompletion = originalChatCompletion;
        motionDirector.choreograph = originalChoreograph;
        global.paramDirector = originalParamDirector;
    }
}

testDirectorWaitsForChoreographyBeforeTts()
    .then(() => console.log('LLM motion/TTS order tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
