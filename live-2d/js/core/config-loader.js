const fs = require('fs');
const path = require('path');
const os = require('os');
const { llmProviderManager } = require('./llm-provider.js');

class ConfigLoader {
    constructor() {
        this.config = null;
        this.configPath = path.join(__dirname, '..', '..', 'config.json');
        this.defaultConfigPath = path.join(__dirname, '..', '..', 'default_config.json');
    }

    // 修改后的加载配置文件方法，如果格式不对就直接报错
    load() {
        try {
            // 直接读取配置文件
            const configData = fs.readFileSync(this.configPath, 'utf8');
            
            try {
                // 尝试解析 JSON
                this.config = JSON.parse(configData);
            } catch (parseError) {
                // JSON 解析失败，说明格式不对
                throw new Error(`JSON格式错误: ${parseError.message}`);
            }
            
            console.log('配置文件加载成功');
            
            // 处理特殊路径，例如 ~ 表示用户主目录
            this.processSpecialPaths();

            // 初始化 LLM 提供商管理器（支持新旧两种配置格式）
            this.initLLMProviders();

            // 兼容层：确保 config.llm 中始终有 api_key/api_url/model 字段
            // 这样旧代码（直接读取 config.llm.api_key 的地方）不会报错
            this.ensureLLMCompat();
            
            return this.config;
        } catch (error) {
            console.error('配置文件读取失败:', error);
            throw error; // 直接抛出错误，不提供默认配置
        }
    }

    /**
     * 初始化 LLM 提供商管理器
     * 从 config.llm_providers 或旧格式 config.llm 中加载提供商
     */
    initLLMProviders() {
        llmProviderManager.init(this.config);
    }

    /**
     * 兼容层：将 provider 配置回填到 config.llm 中
     * 确保旧代码（config.llm.api_key 等）仍能正常工作
     */
    ensureLLMCompat() {
        if (!this.config.llm) this.config.llm = {};

        // 如果 llm 中有 provider_id 但没有 api_key，从 provider 回填。
        // 这里同时带上 llm.model_id，确保旧代码读取到的 config.llm.model
        // 与新 provider 注册表里当前选中的模型一致。
        if (this.config.llm.provider_id && !this.config.llm.api_key) {
            const provider = llmProviderManager.resolveProvider(
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

        // 如果 vision 中有 provider_id，回填 vision_model。
        // 这里显式使用 vision.model_id，避免视觉链路总是回退到 provider 的第一个模型。
        if (this.config.vision && this.config.vision.provider_id) {
            const visionProvider = llmProviderManager.resolveProvider(
                this.config.vision.provider_id,
                this.config.vision.vision_model || null,
                this.config.vision.model_id || this.config.vision.vision_model?.model || null
            );
            if (visionProvider && visionProvider.id !== '_empty') {
                if (!this.config.vision.vision_model) {
                    this.config.vision.vision_model = {};
                }
                // 只有 provider_id 指定了有效的提供商时才回填
                this.config.vision.vision_model.api_key = visionProvider.api_key;
                this.config.vision.vision_model.api_url = visionProvider.api_url;
                // 优先使用 vision.model_id，回退到 provider 的第一个启用模型
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
    
    // 处理特殊路径，比如将 ~ 展开为用户主目录
    processSpecialPaths() {
        if (this.config.vision && this.config.vision.screenshot_path) {
            this.config.vision.screenshot_path = this.config.vision.screenshot_path.replace(/^~/, os.homedir());
        }
    }

    // 保存配置
    save(config = null) {
        try {
            const configToSave = config || this.config;
            if (!configToSave) {
                throw new Error('没有可保存的配置');
            }
            
            // 创建配置文件备份
            if (fs.existsSync(this.configPath)) {
                const backupPath = `${this.configPath}.bak`;
                fs.copyFileSync(this.configPath, backupPath);
                console.log(`已创建配置文件备份: ${backupPath}`);
            }
            
            // 保存配置
            fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), 'utf8');
            console.log('配置已保存');
            return true;
        } catch (error) {
            console.error('保存配置失败:', error);
            return false;
        }
    }
}

// 创建并导出单例
const configLoader = new ConfigLoader();
module.exports = { configLoader };
