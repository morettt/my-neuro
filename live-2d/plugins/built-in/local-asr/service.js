module.exports = function resolveLaunch(config) {
    if (config.cloud?.baidu_asr?.enabled === true) {
        return { name: '百度流式 ASR（仅本地 VAD）', startArgs: ['--vad-only'] };
    }
    if (config.cloud?.siliconflow_asr?.enabled === true) {
        return { name: 'SiliconFlow ASR（仅本地 VAD）', startArgs: ['--vad-only'] };
    }
    return { name: '本地 ASR', startArgs: [] };
};
