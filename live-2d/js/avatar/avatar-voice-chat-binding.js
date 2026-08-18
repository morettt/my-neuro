'use strict';

function requireMethod(target, methodName) {
    if (typeof target?.[methodName] !== 'function') {
        throw new TypeError(`VoiceChat interface is missing ${methodName}()`);
    }
}

function bindVoiceChatAvatar(voiceChat, model, emotionMapper) {
    if (voiceChat == null) {
        return { bound: false, reason: 'voice-chat-unavailable' };
    }

    requireMethod(voiceChat, 'setModel');
    requireMethod(voiceChat, 'setEmotionMapper');

    voiceChat.setModel(model);
    voiceChat.setEmotionMapper(emotionMapper);

    requireMethod(voiceChat, 'setEmotionMapper');
    return { bound: true };
}

module.exports = { bindVoiceChatAvatar };
