'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    MotionDirector,
    resolveDialogueApi
} = require('../js/ai/motion-director.js');

function createCatalog() {
    return [
        { id: 'ParamAngleX', min: -30, max: 30, default: 0 },
        { id: 'ParamAngleY', min: -30, max: 30, default: 0 },
        { id: 'ParamAngleZ', min: -30, max: 30, default: 0 },
        { id: 'ParamBodyAngleX', min: -30, max: 30, default: 0 },
        { id: 'ParamBodyAngleY', min: -30, max: 30, default: 0 },
        { id: 'ParamBodyAngleZ', min: -30, max: 30, default: 0 },
        { id: 'ParamMouthForm', min: -1, max: 1, default: 0 },
        { id: 'ParamEyeLSmile', min: 0, max: 1, default: 0 },
        { id: 'ParamEyeRSmile', min: 0, max: 1, default: 0 },
        { id: 'EyeL_Squint', min: 0, max: 1, default: 0 },
        { id: 'EyeR_Squint', min: 0, max: 1, default: 0 },
        { id: 'ParamCheek', min: 0, max: 1, default: 0 }
    ];
}

function createParamDirector() {
    return {
        body: [],
        face: [],
        prepareSpeech() {},
        getParamCatalog: createCatalog,
        loadTimeline(frames, _chars, channel) {
            this[channel] = [...frames];
            return frames.length > 0;
        },
        appendTimelineFrames(frames, channel) {
            this[channel].push(...frames);
            return true;
        },
        truncateTimeline() {}
    };
}

function completion(content) {
    return {
        ok: true,
        status: 200,
        async json() {
            return {
                choices: [{ message: { content } }]
            };
        },
        async text() {
            return '';
        }
    };
}

async function main() {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'ai', 'motion-director.js'),
        'utf8'
    );
    // Choreography reuses the main dialogue connection. Reading a provider or
    // model selection out of the motion_director block would let it drift onto a
    // second provider, so the selection may only ever come from config.llm.
    assert.ok(!source.includes('cfg.provider_id'));
    assert.ok(!source.includes('cfg.model_id'));
    assert.ok(!source.includes("motion_director?.provider_id"));
    assert.ok(!source.includes('/embeddings'));

    const config = {
        llm: {
            api_url: 'https://main-dialogue.example/v1/',
            api_key: 'main-dialogue-secret',
            model: 'main-dialogue-model'
        },
        ui: { avatar_motion_mode: 'director' },
        motion_director: {
            enabled: true,
            stream: false,
            // These legacy-looking values must never override config.llm.
            api_url: 'https://wrong.example/v1',
            api_key: 'wrong-secret',
            model: 'wrong-model',
            provider_id: 'wrong-provider',
            model_id: 'wrong-model-id',
            body: { enabled: true },
            face: { enabled: true }
        }
    };

    assert.deepStrictEqual(resolveDialogueApi(config), {
        api_url: 'https://main-dialogue.example/v1',
        api_key: 'main-dialogue-secret',
        model: 'main-dialogue-model'
    });

    const previous = global.paramDirector;
    global.paramDirector = createParamDirector();
    const requests = [];
    const director = new MotionDirector({
        fetchImpl: async (url, options) => {
            requests.push({
                url,
                authorization: options.headers.Authorization,
                body: JSON.parse(options.body)
            });
            const system = JSON.parse(options.body).messages[0].content;
            if (system.includes('body choreographer')) {
                return completion('{"at":0.2,"x":1,"y":2,"z":1}');
            }
            return completion('{"at":0.2,"au":{"12":0.7,"6":0.5}}');
        }
    });

    try {
        const result = await director.choreograph(
            '<开心>这次使用主对话模型来生成动作。',
            config
        );
        assert.ok(result.accepted >= 2);
        assert.strictEqual(requests.length, 2);
        for (const request of requests) {
            assert.strictEqual(
                request.url,
                'https://main-dialogue.example/v1/chat/completions'
            );
            assert.strictEqual(
                request.authorization,
                'Bearer main-dialogue-secret'
            );
            assert.strictEqual(request.body.model, 'main-dialogue-model');
            assert.ok(!JSON.stringify(request.body).includes('wrong-secret'));
            assert.ok(!JSON.stringify(request.body).includes('wrong-model'));
            assert.ok(!JSON.stringify(request.body).includes('wrong-provider'));
        }
    } finally {
        director.cancel();
        global.paramDirector = previous;
    }

    console.log('Motion director main dialogue API tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
