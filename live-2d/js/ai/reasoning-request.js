'use strict';

/**
 * 思考/推理模式请求体规则。
 * 缺省关闭：未显式 reasoning_enabled === true 时，明确发送 thinking.type=disabled，
 * 且绝不附带 reasoning_effort（避免 DeepSeek 等接口 400）。
 */

function isReasoningEnabled(source) {
    if (!source || typeof source !== 'object') {
        return false;
    }
    return source.reasoning_enabled === true || source.reasoningEnabled === true;
}

function getReasoningEffort(source) {
    if (!source || typeof source !== 'object') {
        return '';
    }
    const effort = source.reasoning_effort || source.reasoningEffort;
    if (typeof effort !== 'string') {
        return '';
    }
    return effort.trim();
}

function applyReasoningToRequestBody(requestBody, source) {
    if (!requestBody || typeof requestBody !== 'object') {
        return requestBody;
    }
    if (isReasoningEnabled(source)) {
        requestBody.thinking = { type: 'enabled' };
        const effort = getReasoningEffort(source);
        if (effort) {
            requestBody.reasoning_effort = effort;
        } else {
            delete requestBody.reasoning_effort;
        }
    } else {
        requestBody.thinking = { type: 'disabled' };
        delete requestBody.reasoning_effort;
    }
    return requestBody;
}

module.exports = {
    isReasoningEnabled,
    getReasoningEffort,
    applyReasoningToRequestBody
};
