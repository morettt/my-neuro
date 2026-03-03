const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * YAML 解析器（简化版，支持基本 YAML 格式）
 * 用于解析和序列化 YAML 配置文件
 */
class SimpleYAML {
    /**
     * 解析 YAML 字符串为 JavaScript 对象
     * @param {string} yamlStr - YAML 字符串
     * @returns {Object} 解析后的对象
     */
    static parse(yamlStr) {
        const lines = yamlStr.split('\n');
        const result = {};
        const stack = [{ obj: result, indent: -1 }];
        
        let currentKey = null;
        let inMultiline = false;
        let multilineIndent = 0;
        let multilineLines = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const stripped = line.trimStart();
            const indent = line.length - stripped.length;
            
            if (!stripped || stripped.startsWith('#')) {
                continue;
            }
            
            if (inMultiline) {
                if (indent > multilineIndent || stripped === '') {
                    multilineLines.push(stripped);
                    continue;
                } else {
                    inMultiline = false;
                    if (multilineLines.length > 0) {
                        const value = multilineLines.join('\n').trim();
                        stack[stack.length - 1].obj[currentKey] = value;
                    }
                    multilineLines = [];
                }
            }
            
            while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                stack.pop();
            }
            
            const current = stack[stack.length - 1].obj;
            
            if (stripped.includes(':')) {
                const colonIndex = stripped.indexOf(':');
                const key = stripped.substring(0, colonIndex).trim();
                let value = stripped.substring(colonIndex + 1).trim();
                
                if (value === '' || value.startsWith('#')) {
                    currentKey = key;
                    current[key] = {};
                    stack.push({ obj: current[key], indent: indent });
                } else if (value === '|' || value === '>') {
                    currentKey = key;
                    inMultiline = true;
                    multilineIndent = indent;
                    multilineLines = [];
                } else {
                    value = this.parseValue(value);
                    current[key] = value;
                }
            } else if (stripped.startsWith('- ')) {
                if (!Array.isArray(current)) {
                    const parent = stack[stack.length - 2];
                    const key = Object.keys(parent.obj).find(k => parent.obj[k] === current);
                    if (key) {
                        parent.obj[key] = [];
                        stack[stack.length - 1].obj = parent.obj[key];
                    }
                }
            }
        }
        
        if (inMultiline && multilineLines.length > 0) {
            const value = multilineLines.join('\n').trim();
            stack[stack.length - 1].obj[currentKey] = value;
        }
        
        return result;
    }
    
    /**
     * 解析 YAML 值
     * @param {string} value - 值字符串
     * @returns {*} 解析后的值
     */
    static parseValue(value) {
        if (value.startsWith('"') && value.endsWith('"')) {
            return value.slice(1, -1);
        }
        if (value.startsWith("'") && value.endsWith("'")) {
            return value.slice(1, -1);
        }
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        if (!isNaN(Number(value)) && value !== '') {
            return Number(value);
        }
        return value;
    }
    
    /**
     * 将 JavaScript 对象序列化为 YAML 字符串
     * @param {Object} obj - 要序列化的对象
     * @param {number} indent - 缩进级别
     * @returns {string} YAML 字符串
     */
    static stringify(obj, indent = 0) {
        const spaces = '  '.repeat(indent);
        let result = '';
        
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    result += `${spaces}${key}:\n`;
                    result += this.stringify(value, indent + 1);
                } else if (typeof value === 'string') {
                    if (value.includes('\n')) {
                        result += `${spaces}${key}: |\n`;
                        const lines = value.split('\n');
                        for (const line of lines) {
                            result += `${spaces}  ${line}\n`;
                        }
                    } else if (value === '' || value.includes(':') || value.includes('#') || value.includes(' ')) {
                        result += `${spaces}${key}: "${value}"\n`;
                    } else {
                        result += `${spaces}${key}: ${value}\n`;
                    }
                } else if (typeof value === 'boolean') {
                    result += `${spaces}${key}: ${value}\n`;
                } else if (typeof value === 'number') {
                    result += `${spaces}${key}: ${value}\n`;
                } else if (value === null) {
                    result += `${spaces}${key}: null\n`;
                } else if (Array.isArray(value)) {
                    result += `${spaces}${key}:\n`;
                    for (const item of value) {
                        if (typeof item === 'object') {
                            result += `${spaces}  -\n`;
                            result += this.stringify(item, indent + 2);
                        } else {
                            result += `${spaces}  - ${item}\n`;
                        }
                    }
                }
            }
        }
        
        return result;
    }
}

class ConfigLoader {
    constructor() {
        this.config = null;
        this.configPath = path.join(__dirname, '..', '..', 'config.yaml');
        this.jsonConfigPath = path.join(__dirname, '..', '..', 'config.json');
    }

    /**
     * 加载配置文件
     * 优先加载 YAML 文件，如果不存在则尝试从 JSON 迁移
     * @returns {Object} 配置对象
     */
    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                this.config = SimpleYAML.parse(configData);
                console.log('YAML 配置文件加载成功');
            } else if (fs.existsSync(this.jsonConfigPath)) {
                const jsonData = fs.readFileSync(this.jsonConfigPath, 'utf8');
                this.config = JSON.parse(jsonData);
                this.migrateToYaml();
                console.log('已从 JSON 迁移到 YAML 配置');
            } else {
                throw new Error('配置文件不存在');
            }
            
            this.processSpecialPaths();
            
            return this.config;
        } catch (error) {
            console.error('配置文件读取失败:', error);
            throw error;
        }
    }
    
    /**
     * 将 JSON 配置迁移到 YAML 格式
     */
    migrateToYaml() {
        try {
            const yamlContent = SimpleYAML.stringify(this.config);
            fs.writeFileSync(this.configPath, yamlContent, 'utf8');
            console.log(`配置已迁移到 YAML: ${this.configPath}`);
            
            if (fs.existsSync(this.jsonConfigPath)) {
                const backupPath = this.jsonConfigPath + '.bak';
                fs.renameSync(this.jsonConfigPath, backupPath);
                console.log(`原 JSON 配置已备份到: ${backupPath}`);
            }
        } catch (error) {
            console.error('迁移配置到 YAML 失败:', error);
        }
    }
    
    /**
     * 处理特殊路径，比如将 ~ 展开为用户主目录
     */
    processSpecialPaths() {
        if (this.config.vision && this.config.vision.screenshot_path) {
            this.config.vision.screenshot_path = this.config.vision.screenshot_path.replace(/^~/, os.homedir());
        }
    }

    /**
     * 保存配置到 YAML 文件，保留注释
     * @param {Object} config - 要保存的配置对象
     * @returns {boolean} 是否保存成功
     */
    save(config = null) {
        try {
            const configToSave = config || this.config;
            if (!configToSave) {
                throw new Error('没有可保存的配置');
            }
            
            if (fs.existsSync(this.configPath)) {
                const existingContent = fs.readFileSync(this.configPath, 'utf8');
                const newContent = this.updateYamlPreserveComments(existingContent, configToSave);
                fs.writeFileSync(this.configPath, newContent, 'utf8');
            } else {
                const yamlContent = SimpleYAML.stringify(configToSave);
                fs.writeFileSync(this.configPath, yamlContent, 'utf8');
            }
            
            console.log('配置已保存到 YAML 文件');
            return true;
        } catch (error) {
            console.error('保存配置失败:', error);
            return false;
        }
    }
    
    /**
     * 更新 YAML 内容但保留注释
     * @param {string} existingContent - 现有的 YAML 内容
     * @param {Object} newConfig - 新的配置对象
     * @returns {string} 更新后的 YAML 内容
     */
    updateYamlPreserveComments(existingContent, newConfig) {
        const lines = existingContent.split('\n');
        const resultLines = [];
        
        const currentPath = [];
        const indentStack = [-1];
        
        let skipMultiline = false;
        let skipMultilineIndent = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const stripped = line.trimStart();
            const currentIndent = line.length - stripped.length;
            
            if (skipMultiline) {
                if (stripped === '') {
                    continue;
                }
                if (currentIndent > skipMultilineIndent) {
                    continue;
                } else {
                    skipMultiline = false;
                }
            }
            
            if (!stripped || stripped.startsWith('#')) {
                resultLines.push(line);
                continue;
            }
            
            while (indentStack.length > 0 && currentIndent <= indentStack[indentStack.length - 1]) {
                if (currentPath.length > 0) {
                    currentPath.pop();
                }
                indentStack.pop();
            }
            
            if (stripped.includes(':')) {
                const colonPos = stripped.indexOf(':');
                const key = stripped.substring(0, colonPos).trim();
                
                const valuePart = stripped.substring(colonPos + 1).trim();
                
                const isOriginalMultiline = valuePart === '|' || valuePart === '>';
                
                const hasValue = valuePart !== '' && !valuePart.startsWith('#');
                
                if (hasValue && !isOriginalMultiline) {
                    currentPath.push(key);
                    const targetValue = this.getNestedValue(newConfig, currentPath);
                    
                    if (targetValue !== undefined && targetValue !== null) {
                        if (typeof targetValue === 'string') {
                            if (targetValue.includes('\n')) {
                                resultLines.push(line.substring(0, currentIndent) + key + ': |');
                                for (const contentLine of targetValue.split('\n')) {
                                    resultLines.push(' '.repeat(currentIndent + 2) + contentLine);
                                }
                                skipMultiline = true;
                                skipMultilineIndent = currentIndent;
                            } else if (targetValue === '' || targetValue.includes(':') || targetValue.includes('#') || targetValue.includes(' ')) {
                                resultLines.push(line.substring(0, currentIndent) + key + `: "${targetValue}"`);
                            } else {
                                resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                            }
                        } else if (typeof targetValue === 'boolean') {
                            resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                        } else if (typeof targetValue === 'number') {
                            resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                        } else {
                            resultLines.push(line);
                        }
                    } else {
                        resultLines.push(line);
                    }
                    
                    currentPath.pop();
                } else if (isOriginalMultiline) {
                    currentPath.push(key);
                    const targetValue = this.getNestedValue(newConfig, currentPath);
                    
                    skipMultiline = true;
                    skipMultilineIndent = currentIndent;
                    
                    if (targetValue !== undefined && targetValue !== null && typeof targetValue === 'string') {
                        if (targetValue.includes('\n')) {
                            resultLines.push(line.substring(0, currentIndent) + key + ': |');
                            for (const contentLine of targetValue.split('\n')) {
                                resultLines.push(' '.repeat(currentIndent + 2) + contentLine);
                            }
                        } else if (targetValue === '' || targetValue.includes(':') || targetValue.includes('#') || targetValue.includes(' ')) {
                            resultLines.push(line.substring(0, currentIndent) + key + `: "${targetValue}"`);
                        } else {
                            resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                        }
                    } else {
                        resultLines.push(line.substring(0, currentIndent) + key + ': ""');
                    }
                    
                    currentPath.pop();
                } else {
                    currentPath.push(key);
                    const targetValue = this.getNestedValue(newConfig, currentPath);
                    
                    if (targetValue !== undefined && targetValue !== null) {
                        if (typeof targetValue === 'string') {
                            if (targetValue.includes('\n')) {
                                resultLines.push(line.substring(0, currentIndent) + key + ': |');
                                for (const contentLine of targetValue.split('\n')) {
                                    resultLines.push(' '.repeat(currentIndent + 2) + contentLine);
                                }
                                skipMultiline = true;
                                skipMultilineIndent = currentIndent;
                            } else if (targetValue === '' || targetValue.includes(':') || targetValue.includes('#') || targetValue.includes(' ')) {
                                resultLines.push(line.substring(0, currentIndent) + key + `: "${targetValue}"`);
                            } else {
                                resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                            }
                        } else if (typeof targetValue === 'boolean') {
                            resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                        } else if (typeof targetValue === 'number') {
                            resultLines.push(line.substring(0, currentIndent) + key + `: ${targetValue}`);
                        } else {
                            resultLines.push(line);
                        }
                        indentStack.push(currentIndent);
                    } else {
                        indentStack.push(currentIndent);
                        resultLines.push(line);
                    }
                }
            } else {
                resultLines.push(line);
            }
        }
        
        return resultLines.join('\n');
    }
    
    /**
     * 根据路径获取嵌套配置值
     * @param {Object} config - 配置对象
     * @param {Array} path - 路径数组
     * @returns {*} 配置值
     */
    getNestedValue(config, path) {
        let current = config;
        for (const key of path) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return undefined;
            }
        }
        return current;
    }
}

const configLoader = new ConfigLoader();
module.exports = { configLoader, SimpleYAML };
