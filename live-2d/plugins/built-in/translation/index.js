const { Plugin } = require('../../../js/core/plugin-base.js');

class TranslationPlugin extends Plugin {

    async onTTSText(text) {
        const config = this.context.getConfig();
        if (!config.translation?.enabled) return text;

        const { api_key, api_url, model, system_prompt } = config.translation;
        if (!api_key || !api_url || !model) return text;

        try {
            const res = await fetch(`${api_url}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${api_key}`
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: system_prompt },
                        { role: 'user', content: text }
                    ],
                    stream: false
                })
            });

            if (!res.ok) return text;
            const data = await res.json();
            return data.choices[0].message.content || text;
        } catch (e) {
            this.context.log('warn', `翻译失败: ${e.message}`);
            return text;
        }
    }
}

module.exports = TranslationPlugin;
