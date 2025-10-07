const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigLoader {
    constructor() {
        this.config = null;
        this.configPath = path.join(__dirname, '..', 'config.json');
        this.defaultConfigPath = path.join(__dirname, '..', 'default_config.json');
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
            
            return this.config;
        } catch (error) {
            console.error('配置文件读取失败:', error);
            throw error; // 直接抛出错误，不提供默认配置
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