'use strict';

const assert = require('assert');
const directives = require('../js/ai/motion-directives.js');
const {
    MotionDirector,
    resolveDialogueApi
} = require('../js/ai/motion-director.js');
const {
    shouldUseLegacyEmotionLogic,
    shouldUseParamDirector
} = require('../js/avatar/motion-mode.js');
const {
    shouldRunMotionChoreography
} = require('../js/ai/llm-handler.js');

function responseJson(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        },
        async text() {
            return JSON.stringify(payload);
        }
    };
}

function createCatalog() {
    const entries = [
        ['ParamMouthForm', -1, 1, 0],
        ['ParamEyeLOpen', 0, 1, 1],
        ['ParamEyeROpen', 0, 1, 1],
        ['ParamEyeLSmile', 0, 1, 0],
        ['ParamEyeRSmile', 0, 1, 0],
        ['EyeL_Squint', 0, 1, 0],
        ['EyeR_Squint', 0, 1, 0],
        ['ParamEyeBallX', -1, 1, 0],
        ['ParamEyeBallY', -1, 1, 0],
        ['ParamBrowLY', -1, 1, 0],
        ['ParamBrowRY', -1, 1, 0],
        ['ParamBrowLAngle', -1, 1, 0],
        ['ParamBrowRAngle', -1, 1, 0],
        ['ParamCheek', 0, 1, 0],
        ['Param100', 0, 1, 0],
        ['Param74', 0, 1, 0],
        ['ParamJawOpen', 0, 1, 0],
        ['ParamMouthFunnel', -1, 1, 0],
        ['ParamMouthPressLipOpen', -1, 1, 0],
        ['ParamMouthPuckerWiden', -1, 1, 0],
        ['ParamMouthX', -1, 1, 0],
        ['ParamMouthShrug', -1, 1, 0],
        ['ParamAngleX', -30, 30, 0],
        ['ParamAngleY', -30, 30, 0],
        ['ParamAngleZ', -30, 30, 0],
        ['Param3', -30, 30, 0],
        ['Param4', -30, 30, 0],
        ['Param5', -30, 30, 0],
        ['ParamBodyAngleX', -30, 30, 0],
        ['ParamBodyAngleY', -30, 30, 0],
        ['ParamBodyAngleZ', -30, 30, 0]
    ];
    return entries.map(([id, min, max, defaultValue]) => ({
        id,
        min,
        max,
        default: defaultValue
    }));
}

function createParamDirectorMock() {
    const timelines = { body: [], face: [] };
    return {
        timelines,
        prepareSpeech(totalChars) {
            this.totalChars = totalChars;
            timelines.body = [];
            timelines.face = [];
        },
        getParamCatalog() {
            return createCatalog();
        },
        loadTimeline(frames, _totalChars, channel) {
            timelines[channel] = [...frames];
            return frames.length > 0;
        },
        appendTimelineFrames(frames, channel) {
            timelines[channel].push(...frames);
            return frames.length > 0;
        },
        truncateTimeline() {}
    };
}

function testDirectiveParsing() {
    const analyzed = directives.analyzeSpeechMotionInstruction(
        '好呀（对你眨眨右眼）',
        '请帮我点头并脸红一下'
    );
    assert.ok(analyzed.explicitMotionDirectives.length >= 2);
    assert.strictEqual(directives.detectWinkSide(['眨右眼']), 'right');

    const catalog = new Map(createCatalog().map(item => [item.id, item]));
    const frames = directives.buildDirectiveFrames(
        analyzed.explicitMotionDirectives,
        catalog
    );
    assert.ok(frames.faceFrames.length >= 2);
    assert.ok(frames.bodyFrames.length >= 1);
    assert.ok(frames.applied.includes('wink:right'));
    assert.ok(frames.applied.includes('blush'));
}

async function testFallbackAndMainApiReuse() {
    const previous = global.paramDirector;
    const paramDirector = createParamDirectorMock();
    global.paramDirector = paramDirector;
    const calls = [];
    const director = new MotionDirector({
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            const body = JSON.parse(options.body);
            assert.strictEqual(body.model, 'dialogue-model');
            assert.strictEqual(options.headers.Authorization, 'Bearer main-key');
            const content = body.messages[0].content.includes('body')
                ? '{"at":0.2,"x":2,"y":-3,"z":1,"t":300,"h":400,"r":900}\n'
                : '{"at":0.2,"au":{"12":0.9,"6":0.8},"gaze":[0.1,-0.1]}\n';
            return responseJson({
                choices: [{ message: { content } }]
            });
        }
    });
    const config = {
        llm: {
            api_url: 'https://dialogue.example/v1/',
            api_key: 'main-key',
            model: 'dialogue-model'
        },
        ui: { avatar_motion_mode: 'blend' },
        motion_director: {
            enabled: true,
            stream: false,
            timeout_ms: 3000,
            body: { enabled: true },
            face: { enabled: true }
        }
    };

    try {
        const result = await director.choreograph(
            '<开心>今天心情很好（眨眨右眼）',
            config,
            { userMessage: '请帮我点头' }
        );
        assert.ok(result.accepted >= 2, 'body and face API frames should be accepted');
        assert.strictEqual(calls.length, 2);
        assert.ok(calls.every(call => (
            call.url === 'https://dialogue.example/v1/chat/completions'
        )));
        assert.ok(paramDirector.timelines.body.length > 0);
        assert.ok(paramDirector.timelines.face.length > 0);
        assert.strictEqual(
            paramDirector.totalChars,
            '今天心情很好（眨眨右眼）'.length,
            'timeline length should match the TTS text after emotion tags are removed'
        );
    } finally {
        director.cancel();
        global.paramDirector = previous;
    }
}

async function testStreamingAndFallback() {
    const previous = global.paramDirector;
    const paramDirector = createParamDirectorMock();
    global.paramDirector = paramDirector;
    let requestCount = 0;
    const streamBody = [
        `data: ${JSON.stringify({
            choices: [{
                delta: {
                    content: '{"at":0.1,"x":1,"y":2,"z":0,"t":200,"h":200,"r":500}\n'
                }
            }]
        })}`,
        '',
        `data: ${JSON.stringify({
            choices: [{
                delta: {
                    content: '{"at":0.5,"x":2,"y":1,"z":0,"t":200,"h":200,"r":500}\n'
                }
            }]
        })}`,
        '',
        'data: [DONE]',
        ''
    ].join('\n');
    const director = new MotionDirector({
        fetchImpl: async (_url, options) => {
            requestCount++;
            assert.strictEqual(JSON.parse(options.body).stream, true);
            return {
                ok: true,
                status: 200,
                body: {
                    async *[Symbol.asyncIterator]() {
                        yield Buffer.from(streamBody);
                    }
                }
            };
        }
    });
    const config = {
        llm: {
            api_url: 'https://dialogue.example',
            api_key: 'key',
            model: 'model'
        },
        ui: { avatar_motion_mode: 'blend' },
        motion_director: {
            enabled: true,
            stream: true,
            body: { enabled: true },
            face: { enabled: false }
        }
    };
    try {
        const result = await director.choreograph('你好呀', config);
        assert.ok(result.accepted >= 1);
        assert.strictEqual(requestCount, 1);
        assert.ok(paramDirector.timelines.body.length > 0);
    } finally {
        director.cancel();
        global.paramDirector = previous;
    }
}

async function testRawNdjsonAndJsonEnvelopeStreaming() {
    const previous = global.paramDirector;
    const paramDirector = createParamDirectorMock();
    global.paramDirector = paramDirector;
    const config = {
        llm: {
            api_url: 'https://dialogue.example',
            api_key: 'key',
            model: 'model'
        },
        ui: { avatar_motion_mode: 'blend' },
        motion_director: {
            enabled: true,
            stream: true,
            body: { enabled: true },
            face: { enabled: false }
        }
    };

    try {
        const rawNdjsonDirector = new MotionDirector({
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                body: {
                    async *[Symbol.asyncIterator]() {
                        yield '{"at":0.2,"x":1,"y":2,"z":0}\n';
                        yield '{"at":0.8,"x":-1,"y":-2,"z":0}';
                    }
                }
            })
        });
        const rawNdjsonResult = await rawNdjsonDirector.choreograph(
            '原始 NDJSON 流式响应',
            config
        );
        assert.ok(rawNdjsonResult.accepted >= 2);
        rawNdjsonDirector.cancel();

        const jsonEnvelopeDirector = new MotionDirector({
            fetchImpl: async () => responseJson({
                choices: [{
                    message: {
                        content: '{"at":0.4,"x":2,"y":1,"z":0}'
                    }
                }]
            })
        });
        const jsonEnvelopeResult = await jsonEnvelopeDirector.choreograph(
            '接口忽略 stream 时返回普通 JSON',
            config
        );
        assert.ok(jsonEnvelopeResult.accepted >= 1);
        jsonEnvelopeDirector.cancel();
    } finally {
        global.paramDirector = previous;
    }
}

async function testApiFailureKeepsFallback() {
    const previous = global.paramDirector;
    const paramDirector = createParamDirectorMock();
    global.paramDirector = paramDirector;
    const director = new MotionDirector({
        fetchImpl: async () => responseJson({
            error: 'rate limited',
            request_id: 'server-body-must-not-be-logged'
        }, 429)
    });
    const config = {
        llm: {
            api_url: 'https://dialogue.example',
            api_key: 'key',
            model: 'model'
        },
        ui: { avatar_motion_mode: 'blend' },
        motion_director: {
            enabled: true,
            stream: false,
            body: { enabled: true },
            face: { enabled: true }
        }
    };
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(String(message));
    try {
        const result = await director.choreograph('这是一段足够长的回复，用来测试失败回退。', config);
        assert.strictEqual(result.source, 'fallback-only');
        assert.ok(paramDirector.timelines.body.length > 0);
        assert.ok(paramDirector.timelines.face.length > 0);
    } finally {
        console.warn = originalWarn;
        director.cancel();
        global.paramDirector = previous;
    }
    assert.ok(
        warnings.some(message => message.includes('HTTP 429')),
        'the status code should remain observable'
    );
    assert.strictEqual(
        warnings.some(message => message.includes('server-body-must-not-be-logged')),
        false,
        'the provider error body must not be copied into choreography logs'
    );
}

async function testLegacyModeSkipsApi() {
    const previous = global.paramDirector;
    const paramDirector = createParamDirectorMock();
    global.paramDirector = paramDirector;
    let requestCount = 0;
    const director = new MotionDirector({
        fetchImpl: async () => {
            requestCount++;
            return responseJson({});
        }
    });
    const config = {
        llm: {
            api_url: 'https://dialogue.example',
            api_key: 'key',
            model: 'model'
        },
        ui: { avatar_motion_mode: 'legacy' },
        motion_director: { enabled: true }
    };
    try {
        const result = await director.choreograph('传统动作模式', config);
        assert.strictEqual(result.source, 'disabled');
        assert.strictEqual(requestCount, 0);
        assert.strictEqual(paramDirector.totalChars, undefined);
    } finally {
        director.cancel();
        global.paramDirector = previous;
    }
}

async function main() {
    const previousParamDirector = global.paramDirector;
    global.paramDirector = { cancel() {} };
    try {
        assert.strictEqual(
            shouldRunMotionChoreography({
                tts: { enabled: true },
                ui: { avatar_motion_mode: 'blend' },
                motion_director: { enabled: true }
            }),
            true
        );
        assert.strictEqual(
            shouldRunMotionChoreography({
                tts: { enabled: false },
                ui: { avatar_motion_mode: 'blend' },
                motion_director: { enabled: true }
            }),
            false
        );
        assert.strictEqual(
            shouldRunMotionChoreography({
                tts: { enabled: true },
                ui: { avatar_motion_mode: 'blend', text_only_mode: true },
                motion_director: { enabled: true }
            }),
            false
        );
        assert.strictEqual(
            shouldRunMotionChoreography({
                tts: { enabled: true },
                ui: { avatar_motion_mode: 'blend' }
            }),
            false,
            '缺 motion_director.enabled 时必须保持流式，不能默认开启编舞'
        );
        global.paramDirector = undefined;
        assert.strictEqual(
            shouldRunMotionChoreography({
                tts: { enabled: true },
                ui: { avatar_motion_mode: 'blend' },
                motion_director: { enabled: true }
            }),
            false,
            'paramDirector 缺席时不能开启编舞'
        );
    } finally {
        global.paramDirector = previousParamDirector;
    }
    assert.strictEqual(
        shouldUseLegacyEmotionLogic({ ui: { avatar_motion_mode: 'blend' } }),
        true
    );
    assert.strictEqual(
        shouldUseParamDirector({ ui: { avatar_motion_mode: 'blend' } }),
        true
    );
    assert.strictEqual(
        shouldUseLegacyEmotionLogic({ ui: { avatar_motion_mode: 'legacy' } }),
        true
    );
    assert.strictEqual(
        shouldUseParamDirector({ ui: { avatar_motion_mode: 'legacy' } }),
        false
    );
    assert.strictEqual(
        shouldUseLegacyEmotionLogic({ ui: { avatar_motion_mode: 'director' } }),
        false
    );
    assert.strictEqual(
        shouldUseParamDirector({ ui: { avatar_motion_mode: 'director' } }),
        true
    );
    assert.deepStrictEqual(
        resolveDialogueApi({
            llm: {
                api_url: 'https://example/v1/',
                api_key: 'k',
                model: 'm'
            }
        }),
        {
            api_url: 'https://example/v1',
            api_key: 'k',
            model: 'm'
        }
    );
    assert.strictEqual(resolveDialogueApi({ llm: {} }), null);
    testDirectiveParsing();
    await testFallbackAndMainApiReuse();
    await testStreamingAndFallback();
    await testRawNdjsonAndJsonEnvelopeStreaming();
    await testApiFailureKeepsFallback();
    await testLegacyModeSkipsApi();
    console.log('Motion director module tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
