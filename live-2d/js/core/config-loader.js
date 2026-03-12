const fs = require('fs');
const path = require('path');
const os = require('os');
const { llmProviderManager } = require('./llm-provider.js');
const { resolveProvidersForConfig } = require('./llm-provider-store.js');

class ConfigLoader {
    constructor() {
        this.config = null;
        this.configPath = path.join(__dirname, '..', '..', 'config.json');
        this.defaultConfigPath = path.join(__dirname, '..', '..', 'default_config.json');
        this.baseDir = path.join(__dirname, '..', '..');
    }

    load() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');

            try {
                this.config = JSON.parse(configData);
            } catch (parseError) {
                throw new Error(`JSON格式错误: ${parseError.message}`);
            }

            console.log('配置文件加载成功');
            resolveProvidersForConfig(this.baseDir, this.config);

            this.processSpecialPaths();
            this.initLLMProviders();
            this.ensureLLMCompat();

            return this.config;
        } catch (error) {
            console.error('配置文件读取失败:', error);
            throw error;
        }
    }

    initLLMProviders() {
        llmProviderManager.init(this.config);
    }

    ensureLLMCompat() {
        if (!this.config.llm) this.config.llm = {};

        if (this.config.llm.provider_id && !this.config.llm.api_key) {
            const provider = llmProviderManager.resolveProviderOrFallback(
                this.config.llm.provider_id,
                this.config.llm,
                this.config.llm.model_id || this.config.llm.model || null
            );
            if (provider) {
                this.config.llm.api_key = provider.api_key;
                this.config.llm.api_url = provider.api_url;
                this.config.llm.model = provider.model;
                if (provider.temperature !== undefined && this.config.llm.temperature === undefined) {
                    this.config.llm.temperature = provider.temperature;
                }
            }
        }

        if (this.config.vision && this.config.vision.provider_id) {
            const visionProvider = llmProviderManager.resolveProviderOrFallback(
                this.config.vision.provider_id,
                this.config.vision.vision_model || null,
                this.config.vision.model_id || this.config.vision.vision_model?.model || null
            );
            if (visionProvider) {
                if (!this.config.vision.vision_model) {
                    this.config.vision.vision_model = {};
                }
                this.config.vision.vision_model.api_key = visionProvider.api_key;
                this.config.vision.vision_model.api_url = visionProvider.api_url;

                const visionModelId = this.config.vision.model_id;
                if (visionModelId) {
                    this.config.vision.vision_model.model = visionModelId;
                } else if (visionProvider.models && visionProvider.models.length > 0) {
                    const enabledModel = visionProvider.models.find(m => m.enabled !== false);
                    this.config.vision.vision_model.model = enabledModel ? enabledModel.model_id : visionProvider.models[0].model_id;
                } else {
                    this.config.vision.vision_model.model = visionProvider.model || '';
                }
            }
        }
    }

    processSpecialPaths() {
        if (this.config.vision && this.config.vision.screenshot_path) {
            this.config.vision.screenshot_path = this.config.vision.screenshot_path.replace(/^~/, os.homedir());
        }
    }
}

const configLoader = new ConfigLoader();
module.exports = { configLoader };
