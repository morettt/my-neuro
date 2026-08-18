'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const { bindVoiceChatAvatar } = require('../js/avatar/avatar-voice-chat-binding.js');

assert.deepEqual(
    bindVoiceChatAvatar(null, {}, {}),
    { bound: false, reason: 'voice-chat-unavailable' }
);
assert.deepEqual(
    bindVoiceChatAvatar(undefined, {}, {}),
    { bound: false, reason: 'voice-chat-unavailable' }
);

{
    const calls = [];
    const voiceChat = {
        setModel(model) {
            calls.push(['model', model]);
        },
        setEmotionMapper(mapper) {
            calls.push(['emotion', mapper]);
        }
    };
    const model = { id: 'model-a' };
    const mapper = { id: 'mapper-a' };

    assert.deepEqual(bindVoiceChatAvatar(voiceChat, model, mapper), { bound: true });
    assert.deepEqual(calls, [
        ['model', model],
        ['emotion', mapper]
    ]);
    assert.equal(typeof voiceChat.setEmotionMapper, 'function');
}

{
    const models = [];
    const mappers = [];
    const voiceChat = {
        setModel(model) {
            models.push(model);
        },
        setEmotionMapper(mapper) {
            mappers.push(mapper);
        }
    };
    const firstModel = { id: 1 };
    const secondModel = { id: 2 };
    const firstMapper = { id: 1 };
    const secondMapper = { id: 2 };

    bindVoiceChatAvatar(voiceChat, firstModel, firstMapper);
    bindVoiceChatAvatar(voiceChat, secondModel, secondMapper);

    assert.deepEqual(models, [firstModel, secondModel]);
    assert.deepEqual(mappers, [firstMapper, secondMapper]);
    assert.equal(typeof voiceChat.setEmotionMapper, 'function');
}

assert.throws(
    () => bindVoiceChatAvatar({ setEmotionMapper() {} }, {}, {}),
    /setModel/
);
assert.throws(
    () => bindVoiceChatAvatar({ setModel() {} }, {}, {}),
    /setEmotionMapper/
);

{
    const setupPaths = [
        'js/avatar/live2d/setup.js',
        'js/avatar/vrm/setup.js'
    ];
    for (const relativePath of setupPaths) {
        const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
        assert.equal(
            /voiceChat\.setEmotionMapper\s*=/.test(source),
            false,
            `${relativePath} must not overwrite setEmotionMapper`
        );
        assert.equal(
            source.includes('bindVoiceChatAvatar('),
            true,
            `${relativePath} must use the shared binding helper`
        );
    }
}

console.log('avatar voice-chat binding tests passed');
