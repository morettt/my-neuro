// Keep shared config references and conversation history while rebinding the
// clients captured by the dialogue handler after provider settings change.
function applyRuntimeConfig(current, next, { voiceChat, ttsProcessor, resolveProvider, createHandler } = {}) {
    if (current !== next) {
        for (const key of Object.keys(current)) delete current[key];
        Object.assign(current, next);
    }
    if (!voiceChat) return current;
    const resolve = resolveProvider || ((...args) => require('./llm-provider').llmProviderManager.resolveProviderOrFallback(...args));
    const create = createHandler || require('../ai/llm-handler').LLMHandler.createEnhancedSendToLLM;
    const llm = current.llm || {};
    const provider = resolve(llm.provider_id || null, llm.model_id || null) || llm;
    voiceChat.config = current;
    voiceChat.API_URL = provider.api_url || '';
    voiceChat.API_KEY = provider.api_key || '';
    voiceChat.MODEL = provider.model || '';
    const handler = create(voiceChat, ttsProcessor, voiceChat.asrEnabled, current);
    voiceChat.sendToLLM = handler;
    voiceChat.inputRouter?.setLLMHandler(handler);
    return current;
}

module.exports = { applyRuntimeConfig };
