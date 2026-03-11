const { Plugin } = require('../../../js/core/plugin-base.js');

class LLMProviderDemoPlugin extends Plugin {
    async onStart() {
        this.context.log('info', 'llm-provider-demo started');
    }

    getTools() {
        return [{
            type: 'function',
            function: {
                name: 'demo_llm_summary',
                description: '使用插件配置里的 LLM 提供商和模型总结文本',
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: '要总结的文本'
                        }
                    },
                    required: ['text']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name !== 'demo_llm_summary') {
            return undefined;
        }

        const cfg = this.context.getPluginConfig();
        const llm = cfg.llm || {};
        const prefix = cfg.prompt_prefix || '请用简洁中文回答。';
        const text = (params && params.text ? String(params.text) : '').trim();

        if (!text) {
            return '没有提供需要总结的文本。';
        }

        const prompt = `${prefix}\n\n请用 3 条要点总结下面的内容：\n${text}`;

        const result = await this.context.callLLM(prompt, {
            provider_id: llm.provider_id || undefined,
            model: llm.model_id || undefined,
            temperature: Number.isFinite(llm.temperature) ? llm.temperature : 0.7,
            stream: false
        });

        return result;
    }
}

module.exports = LLMProviderDemoPlugin;
