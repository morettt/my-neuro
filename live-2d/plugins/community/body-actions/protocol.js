const COMBINED = /\b(?:and|then|while|whilst|after|before|followed|simultaneously|also|plus)\b|[,;:/&+\n\r]/i;

function isSingleAction(value) {
    const text = String(value).trim();
    return text.length > 0 && text.length <= 120 && !COMBINED.test(text)
        && /^[a-z][a-z\s'-]*[.!]?$/i.test(text);
}

function parseActions(text, maxActions = 4) {
    const actions = [], rejected = [];
    const cleanText = String(text || '').replace(/\[([^\[\]]*)\]/g, (whole, inside) => {
        const action = inside.trim();
        if (isSingleAction(action) && actions.length < maxActions) actions.push(action.replace(/[.!]$/, ''));
        else rejected.push(action);
        return '';
    }).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
    // Drop an unfinished motion tag rather than reading a truncated command aloud.
    const cleaned = stripMotionTags(cleanText).trim();
    return { text: cleaned, actions, rejected };
}

const BODY_PROMPT = `你现在有一个可控制的 3D 身体。你可以在自然语言回复中夹入 [英文动作] 来表达肢体动作。
每对 [] 必须且只能包含一个简单、明确的动作，用简短英文描述。不限制固定动作词表。
参考动作：[Backflip]、[raise your hands]、[Dance]、[Spin in place]、[lying on the ground]、[Standing high jump]。
这些只是参考，你也可以根据情境写其他英文单动作。
正确：[raise left hand]、[wave right hand]、[nod head]、[bow]、[walk forward]。
错误：[raise left hand and turn around]、[wave then bow]。不能在一个括号内组合动作，也不能使用逗号、and、then、while 串联。
若需要多个动作，拆成独立标签，例如：你好呀！[wave right hand] 让我想想。[tilt head left]。
保持正常回复语言，只把身体动作写成英文。动作标签不会被朗读，系统会按标签出现顺序生成并播放。
动作要简短自然，不要每句话都加动作，也不要输出伪代码、动作解释或整段英文旁白。`;

// Display filtering is deliberately independent of executable verb validation:
// unknown, malformed and rejected motion commands must not become dialogue.
function stripMotionTags(text) {
    return String(text || '').replace(/\[[^\[\]]*\]/g, '')
        .replace(/\[[^\[\]]*$/, '').replace(/ {2,}/g, ' ');
}

module.exports = { parseActions, isSingleAction, stripMotionTags, BODY_PROMPT };
