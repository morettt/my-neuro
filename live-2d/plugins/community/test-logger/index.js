// plugins/community/test-logger/index.js
// 框架验证插件：测试各个钩子是否正常被调用

const { Plugin } = require('../../../js/core/plugin-base.js');

class TestLoggerPlugin extends Plugin {

    async onStart() {
        this.context.log('info', '===== 测试插件已启动 =====');
        this.context.log('info', `插件配置: ${JSON.stringify(this.context.getPluginConfig())}`);

        // 测试 storage
        this.context.storage.set('start_time', Date.now());
        this.context.log('info', `storage 写入成功，启动时间: ${new Date().toLocaleTimeString()}`);
    }

    async onUserInput(event) {
        this.context.log('info', `[onUserInput] 来源=${event.source} 文本="${event.text}"`);

        // 测试 addContext：给这次 LLM 请求悄悄追加一句话
        event.addContext('（测试插件注入：当前时间 ' + new Date().toLocaleTimeString() + '）');
        this.context.log('info', '[onUserInput] 已追加上下文');
    }

    async onLLMResponse(response) {
        this.context.log('info', `[onLLMResponse] AI回复前${response.text.length}字: "${response.text.substring(0, 30)}..."`);
    }

    async onTTSEnd() {
        const startTime = this.context.storage.get('start_time');
        const uptime = Math.round((Date.now() - startTime) / 1000);
        this.context.log('info', `[onTTSEnd] TTS播放结束，插件已运行 ${uptime} 秒`);
    }

    async onStop() {
        this.context.log('info', '===== 测试插件已停止 =====');
    }
}

module.exports = TestLoggerPlugin;
