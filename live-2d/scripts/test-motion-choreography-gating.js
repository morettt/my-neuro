'use strict';

// 编舞开关门闩：确认只有「显式开启 + paramDirector 就绪」才会关闭流式 TTS。
// 缺省配置、显式关闭、legacy、paramDirector 缺席这四种情况都必须保持原有流式行为。

const assert = require('assert');
const { LLMHandler, shouldRunMotionChoreography } = require('../js/ai/llm-handler.js');
const { LLMClient } = require('../js/ai/llm-client.js');
const { motionDirector } = require('../js/ai/motion-director.js');

const REPLY = '这是一段完整的最终回复文本。';

function makeParamDirectorStub() {
    return {
        cancel() {},
        prepareSpeech() {},
        noteSpeechProgress() {},
        truncateTimeline() {},
        appendTimelineFrames() { return true; },
        getParamCatalog: () => []
    };
}

async function collectEvents(config, { withParamDirector }) {
    const events = [];
    const originalChatCompletion = LLMClient.prototype.chatCompletion;
    const originalChoreograph = motionDirector.choreograph;
    const originalParamDirector = global.paramDirector;

    global.paramDirector = withParamDirector ? makeParamDirectorStub() : undefined;

    const voiceChat = {
        messages: [],
        enableContextLimit: false,
        shouldTakeScreenshot: async () => false,
        saveConversationHistory() {},
        removeInjectedMemory() {}
    };

    const ttsProcessor = {
        reset() {},
        addStreamingText() { events.push('stream'); },
        finalizeStreamingText() { events.push('finalize'); },
        processTextToSpeech() { events.push('whole'); }
    };

    LLMClient.prototype.chatCompletion = async (_messages, _tools, stream, onChunk) => {
        if (stream && typeof onChunk === 'function') {
            onChunk('这是一段');
            onChunk('完整的最终回复文本。');
        }
        return { content: REPLY, tool_calls: [] };
    };

    // 隔离真实编舞请求，只观察 llm-handler 的调度决策
    motionDirector.choreograph = () => {
        events.push('choreograph');
        const work = Promise.resolve({ accepted: 0 });
        work.firstFrameLoaded = Promise.resolve({ source: 'test' });
        return work;
    };

    try {
        const sendToLLM = LLMHandler.createEnhancedSendToLLM(voiceChat, ttsProcessor, false, config);
        await sendToLLM('你好');
    } finally {
        LLMClient.prototype.chatCompletion = originalChatCompletion;
        motionDirector.choreograph = originalChoreograph;
        global.paramDirector = originalParamDirector;
    }

    return events;
}

function assertStreaming(events, label) {
    assert.ok(events.includes('stream'), `${label}: 必须保持流式送 TTS`);
    assert.ok(events.includes('finalize'), `${label}: 流式结束后必须 finalize`);
    assert.ok(!events.includes('whole'), `${label}: 不应退化成整段播放`);
    assert.ok(!events.includes('choreograph'), `${label}: 不应发起编舞请求`);
}

function assertChoreographed(events, label) {
    assert.ok(events.includes('choreograph'), `${label}: 应发起编舞请求`);
    assert.ok(events.includes('whole'), `${label}: 编舞模式下走整段播放`);
    assert.ok(!events.includes('stream'), `${label}: 编舞模式下不送流式分片`);
}

const baseLlm = { api_url: 'https://example.com/v1', api_key: 'k', model: 'm' };

async function testLegacyUserConfigKeepsStreaming() {
    // 老用户 config.json 里根本没有 motion_director / avatar_motion_mode 字段
    const events = await collectEvents({
        llm: { ...baseLlm },
        tts: { enabled: true },
        ui: {}
    }, { withParamDirector: true });
    assertStreaming(events, '老用户缺省配置');
}

async function testShippedDefaultKeepsStreaming() {
    // 仓库 config.json 的出厂默认值
    const events = await collectEvents({
        llm: { ...baseLlm },
        tts: { enabled: true },
        ui: { avatar_motion_mode: 'blend' },
        motion_director: { enabled: false }
    }, { withParamDirector: true });
    assertStreaming(events, '出厂默认值');
}

async function testExplicitOptInRunsChoreography() {
    const events = await collectEvents({
        llm: { ...baseLlm },
        tts: { enabled: true },
        ui: { avatar_motion_mode: 'blend' },
        motion_director: { enabled: true }
    }, { withParamDirector: true });
    assertChoreographed(events, '显式开启');
}

async function testMissingParamDirectorKeepsStreaming() {
    // VRM 模型或 Live2D attach 失败时 global.paramDirector 为空，
    // 此时编舞不会产生任何效果，不能白白牺牲流式。
    const events = await collectEvents({
        llm: { ...baseLlm },
        tts: { enabled: true },
        ui: { avatar_motion_mode: 'blend', model_type: 'vrm' },
        motion_director: { enabled: true }
    }, { withParamDirector: false });
    assertStreaming(events, '缺少 paramDirector');
}

async function testLegacyModeKeepsStreaming() {
    const events = await collectEvents({
        llm: { ...baseLlm },
        tts: { enabled: true },
        ui: { avatar_motion_mode: 'legacy' },
        motion_director: { enabled: true }
    }, { withParamDirector: true });
    assertStreaming(events, 'legacy 模式');
}

function testGateFunctionDirectly() {
    const originalParamDirector = global.paramDirector;
    try {
        global.paramDirector = makeParamDirectorStub();
        assert.strictEqual(
            shouldRunMotionChoreography({ ui: {} }), false,
            '缺省配置不应开启编舞'
        );
        assert.strictEqual(
            shouldRunMotionChoreography({ motion_director: { enabled: false } }), false,
            '显式关闭不应开启编舞'
        );
        assert.strictEqual(
            shouldRunMotionChoreography({ motion_director: { enabled: true } }), true,
            '显式开启应启用编舞'
        );
        assert.strictEqual(
            shouldRunMotionChoreography({
                tts: { enabled: false },
                motion_director: { enabled: true }
            }), false,
            'TTS 关闭时不应编舞'
        );
        global.paramDirector = undefined;
        assert.strictEqual(
            shouldRunMotionChoreography({ motion_director: { enabled: true } }), false,
            'paramDirector 缺席时不应编舞'
        );
    } finally {
        global.paramDirector = originalParamDirector;
    }
}

(async () => {
    testGateFunctionDirectly();
    await testLegacyUserConfigKeepsStreaming();
    await testShippedDefaultKeepsStreaming();
    await testExplicitOptInRunsChoreography();
    await testMissingParamDirectorKeepsStreaming();
    await testLegacyModeKeepsStreaming();
    console.log('Motion choreography gating tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
