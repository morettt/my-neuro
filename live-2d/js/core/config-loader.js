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
            this.normalizeLegacyConfigShape();

            return this.config;
        } catch (error) {
            console.error('配置文件读取失败:', error);
            throw error;
        }
    }

    initLLMProviders() {
        llmProviderManager.init(this.config);
    }

    normalizeLegacyConfigShape() {
        if (!this.config.llm) this.config.llm = {};

        // 仅保留旧字段结构，不再把 provider 解析结果回写到主配置。
        if (this.config.vision && this.config.vision.provider_id && !this.config.vision.vision_model) {
            this.config.vision.vision_model = {};
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
