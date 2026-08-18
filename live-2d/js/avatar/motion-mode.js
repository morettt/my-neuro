'use strict';

const VALID_AVATAR_MOTION_MODES = new Set(['blend', 'legacy', 'director']);

function normalizeAvatarMotionMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return VALID_AVATAR_MOTION_MODES.has(mode) ? mode : 'blend';
}

function getAvatarMotionMode(config = null) {
    return normalizeAvatarMotionMode(
        config?.ui?.avatar_motion_mode ||
        global.live2dRuntime?.config?.ui?.avatar_motion_mode ||
        global.paramDirector?.config?.ui?.avatar_motion_mode ||
        'blend'
    );
}

function shouldUseLegacyEmotionLogic(config = null) {
    return getAvatarMotionMode(config) !== 'director';
}

function shouldUseParamDirector(config = null) {
    return getAvatarMotionMode(config) !== 'legacy';
}

// 「仅 AI 编舞」档专用门控：本次 soullink 对齐更新的所有新行为统一挂在此判定之后，
// blend / legacy 两档保持原有行为不变（见 SOULLINK_ALIGNMENT_PLAN.md §0.5）。
function isDirectorOnly(config = null) {
    return getAvatarMotionMode(config) === 'director';
}

module.exports = {
    getAvatarMotionMode,
    normalizeAvatarMotionMode,
    shouldUseLegacyEmotionLogic,
    shouldUseParamDirector,
    isDirectorOnly
};
