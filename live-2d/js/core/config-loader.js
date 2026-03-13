const fs = require('fs');
const path = require('path');
const os = require('os');
const { llmProviderManager } = require('./llm-provider.js');
const { ensureProviderStore, saveProviders } = require('./llm-provider-store.js');

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
            const { providers, storeChanged, configChanged } = ensureProviderStore(this.baseDir, this.config);
            if (storeChanged) {
                saveProviders(this.baseDir, providers);
            }
            if (storeChanged || configChanged) {
                fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
            }

            this.processSpecialPaths();
            this.initLLMProviders();

            return this.config;
        } catch (error) {
            console.error('配置文件读取失败:', error);
            throw error;
        }
    }

    initLLMProviders() {
        llmProviderManager.init(this.config);
    }

    processSpecialPaths() {
        if (this.config.vision && this.config.vision.screenshot_path) {
            this.config.vision.screenshot_path = this.config.vision.screenshot_path.replace(/^~/, os.homedir());
        }
    }
}

const configLoader = new ConfigLoader();
module.exports = { configLoader };
