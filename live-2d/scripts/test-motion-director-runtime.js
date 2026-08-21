'use strict';

const assert = require('assert');
const { eventBus } = require('../js/core/event-bus.js');
const { Events } = require('../js/core/events.js');
const { MotionDirector } = require('../js/ai/motion-director.js');
const { ParamDirector } = require('../js/avatar/live2d/param-director.js');

function createCoreModel() {
    const definitions = [
        ['ParamAngleX', -30, 30, 0],
        ['ParamAngleY', -30, 30, 0],
        ['ParamAngleZ', -30, 30, 0],
        ['ParamBodyAngleX', -30, 30, 0],
        ['ParamBodyAngleY', -30, 30, 0],
        ['ParamBodyAngleZ', -30, 30, 0],
        ['ParamMouthForm', -1, 1, 0],
        ['ParamEyeLSmile', 0, 1, 0],
        ['ParamEyeRSmile', 0, 1, 0],
        ['EyeL_Squint', 0, 1, 0],
        ['EyeR_Squint', 0, 1, 0],
        ['ParamCheek', 0, 1, 0]
    ];
    const values = definitions.map(item => item[3]);
    return {
        definitions,
        values,
        getParameterCount: () => definitions.length,
        getParameterId: index => definitions[index][0],
        getParameterMinimumValue: index => definitions[index][1],
        getParameterMaximumValue: index => definitions[index][2],
        getParameterDefaultValue: index => definitions[index][3],
        getParameterValueByIndex: index => values[index],
        setParameterValueByIndex: (index, value) => {
            values[index] = value;
        },
        value(id) {
            const index = definitions.findIndex(item => item[0] === id);
            return values[index];
        }
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
    const config = {
        llm: {
            api_url: 'https://dialogue.example/v1',
            api_key: 'test-key',
            model: 'test-model'
        },
        ui: {
            avatar_motion_mode: 'director',
            body_motion: {
                idle_enabled: false,
                sway_enabled: false,
                director_audio_sway_enabled: false
            }
        },
        motion_director: {
            enabled: true,
            stream: false,
            fallback_enabled: true,
            body: { enabled: true },
            face: { enabled: true },
            vad: { enabled: false },
            face_micro: { enabled: false },
            idle_actions: { enabled: false }
        }
    };

    const coreModel = createCoreModel();
    const model = {
        internalModel: {
            coreModel,
            settings: { url: '2D/test/test.model3.json' }
        }
    };
    const paramDirector = new ParamDirector(config);
    assert.strictEqual(paramDirector.attach(model, coreModel), true);

    const previous = global.paramDirector;
    global.paramDirector = paramDirector;
    const motionDirector = new MotionDirector({
        fetchImpl: async (_url, options) => {
            const system = JSON.parse(options.body).messages[0].content;
            if (system.includes('body choreographer')) {
                return completion([
                    '{"at":0.1,"x":4,"y":6,"z":3,"t":0,"h":500,"r":500}',
                    '{"at":0.6,"x":-2,"y":-4,"z":-2,"t":0,"h":500,"r":500}'
                ].join('\n'));
            }
            return completion([
                '{"at":0.1,"au":{"12":1,"6":0.8}}',
                '{"at":0.6,"au":{"12":0.4,"6":0.3}}'
            ].join('\n'));
        }
    });

    try {
        const result = await motionDirector.choreograph(
            '<开心>这是一段用于验证真实参数时间线的回复。',
            config
        );
        assert.ok(result.accepted >= 4);

        eventBus.emit(Events.TTS_START);
        paramDirector.noteSpeechProgress(6);
        paramDirector.applyFrame(coreModel, performance.now() + 1000, 16, 0);

        const bodyChanged = [
            coreModel.value('ParamAngleX'),
            coreModel.value('ParamAngleY'),
            coreModel.value('ParamAngleZ')
        ].some(value => Math.abs(value) > 0.01);
        const faceChanged = [
            coreModel.value('ParamMouthForm'),
            coreModel.value('ParamEyeLSmile'),
            coreModel.value('ParamCheek')
        ].some(value => Math.abs(value) > 0.01);
        assert.ok(bodyChanged, 'body keyframes should reach the core model');
        assert.ok(faceChanged, 'face keyframes should reach the core model');

        eventBus.emit(Events.TTS_END);
        assert.strictEqual(
            Array.from(paramDirector._timelines.values())
                .every(timeline => timeline.length === 0),
            true,
            'TTS end should clear pending timelines'
        );
    } finally {
        motionDirector.cancel();
        paramDirector.detach();
        global.paramDirector = previous;
    }

    console.log('Motion director runtime integration tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
