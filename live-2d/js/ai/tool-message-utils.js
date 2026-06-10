// tool-message-utils.js - OpenAI 兼容的工具消息序列工具
// 严格模式 API（DeepSeek 等）要求:
//   1. assistant 消息带 tool_calls 时，后面必须紧跟与之一一配对的 tool 响应消息
//   2. tool 消息前面必须存在声明了对应 tool_call_id 的 assistant 消息
// 任何来源的消息序列（内存、持久化历史、裁剪结果）都可能违反上述约束，
// 本模块提供「序列清理」和「不切断工具调用链的裁剪」两个能力。

function hasToolCalls(message) {
    return message?.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0;
}

function getToolCallIds(toolCalls) {
    return (toolCalls || [])
        .map(toolCall => toolCall?.id)
        .filter(id => typeof id === 'string' && id.length > 0);
}

function cloneWithoutToolCalls(message) {
    const { tool_calls, ...rest } = message;
    return { ...rest };
}

function hasUsableAssistantContent(message) {
    if (message?.content == null) return false;
    if (typeof message.content === 'string') return message.content.trim().length > 0;
    return true;
}

// 收集从 startIndex 开始的连续 tool 消息块
function collectConsecutiveToolMessages(messages, startIndex) {
    const toolMessages = [];
    let index = startIndex;

    while (index < messages.length && messages[index]?.role === 'tool') {
        toolMessages.push(messages[index]);
        index++;
    }

    return { toolMessages, nextIndex: index };
}

function findToolMessageById(toolMessages, id, usedIndexes) {
    for (let i = 0; i < toolMessages.length; i++) {
        if (usedIndexes.has(i)) continue;
        if (toolMessages[i]?.tool_call_id === id) {
            usedIndexes.add(i);
            return toolMessages[i];
        }
    }
    return null;
}

/**
 * 清理消息序列，保证 assistant.tool_calls 与 tool 响应严格配对
 * - 孤立的 tool 消息（前面没有声明对应 tool_call_id 的 assistant）直接丢弃
 * - assistant+tool_calls 的后续 tool 响应不完整时，剥离 tool_calls 字段，
 *   有文本内容则保留文本，否则整条丢弃
 * 这样无论历史多「脏」（旧版本保存的断链历史、被裁剪切断的链等），
 * 清理后的序列都能被严格模式 API 接受，不会再报
 * "tool_calls must be followed by tool messages"
 */
function sanitizeToolMessageSequence(messages) {
    if (!Array.isArray(messages)) return [];

    const sanitized = [];

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];

        if (!message || typeof message !== 'object') {
            continue;
        }

        if (message.role === 'tool') {
            // 走到这里说明该 tool 消息没有被前面的 assistant+tool_calls 消费，是孤立消息
            continue;
        }

        if (!hasToolCalls(message)) {
            sanitized.push(message);
            continue;
        }

        const expectedIds = getToolCallIds(message.tool_calls);
        const { toolMessages, nextIndex } = collectConsecutiveToolMessages(messages, i + 1);
        const usedToolIndexes = new Set();
        const matchedTools = expectedIds
            .map(id => findToolMessageById(toolMessages, id, usedToolIndexes))
            .filter(Boolean);

        if (expectedIds.length > 0 && matchedTools.length === expectedIds.length) {
            // 工具调用链完整，按 tool_calls 声明顺序原样保留
            sanitized.push(message, ...matchedTools);
        } else if (hasUsableAssistantContent(message)) {
            // 链不完整，剥离 tool_calls 只保留文本
            sanitized.push(cloneWithoutToolCalls(message));
        }

        // 跳过已处理的连续 tool 块（要么作为完整响应被消费，要么随断链一起丢弃）
        i = nextIndex - 1;
    }

    return sanitized;
}

/**
 * 把消息分组为不可分割的「单元」:
 * assistant+tool_calls 及其后续连续 tool 响应是一个单元，其余消息各自成单元
 */
function buildConversationUnits(messages) {
    const units = [];

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (hasToolCalls(message)) {
            const { toolMessages, nextIndex } = collectConsecutiveToolMessages(messages, i + 1);
            units.push([message, ...toolMessages]);
            i = nextIndex - 1;
        } else {
            units.push([message]);
        }
    }

    return units;
}

/**
 * 按条数裁剪，但以「单元」为最小粒度从后向前保留，保证不切断工具调用链
 * 若最新的单个单元本身就超过上限，也至少完整保留这一个单元
 */
function trimMessagesPreservingToolRounds(messages, maxMessages) {
    const limit = Number(maxMessages);
    if (!Number.isFinite(limit) || limit < 1) {
        return sanitizeToolMessageSequence(messages);
    }

    const sanitized = sanitizeToolMessageSequence(messages);
    const units = buildConversationUnits(sanitized);
    const keptUnits = [];
    let keptCount = 0;

    for (let i = units.length - 1; i >= 0; i--) {
        const unit = units[i];
        if (keptUnits.length > 0 && keptCount + unit.length > limit) {
            break;
        }
        keptUnits.unshift(unit);
        keptCount += unit.length;
    }

    return keptUnits.flat();
}

module.exports = {
    sanitizeToolMessageSequence,
    trimMessagesPreservingToolRounds
};
