/**
 * 工具函数自动扫描导出文件 - 智能化server-tools系统
 */

const fs = require('fs');
const path = require('path');

// 自动扫描tools文件夹下的所有工具文件
const FUNCTIONS = {};

// 获取当前目录下所有.js文件（除了index.js）
const toolFiles = fs.readdirSync(__dirname).filter(file =>
    file.endsWith('.js') && file !== 'index.js'
);

console.log(`🔍 扫描到 ${toolFiles.length} 个工具文件:`, toolFiles);

// 自动导入所有工具文件，并保存源码信息
const SOURCE_CACHE = {};

toolFiles.forEach(file => {
    try {
        // 读取源文件内容
        const filePath = path.join(__dirname, file);
        const sourceCode = fs.readFileSync(filePath, 'utf8');
        SOURCE_CACHE[file] = sourceCode;

        const toolModule = require(filePath);

        // 遍历模块导出的所有函数，添加到FUNCTIONS中（跳过内部接口函数）
        Object.entries(toolModule).forEach(([key, func]) => {
            if (typeof func === 'function' &&
                key !== 'getToolDefinitions' &&
                key !== 'executeFunction') {
                // 将函数名转换为工具调用名（驼峰转下划线）
                const toolName = key.replace(/([A-Z])/g, '_$1').toLowerCase();
                FUNCTIONS[toolName] = func;
                // 保存源文件信息
                FUNCTIONS[toolName]._sourceFile = file;
                FUNCTIONS[toolName]._originalName = key;
                console.log(`📦 加载工具: ${toolName} <- ${file}`);
            }
        });
    } catch (error) {
        console.error(`❌ 加载工具文件失败: ${file}`, error.message);
    }
});

console.log(`✅ 总共加载了 ${Object.keys(FUNCTIONS).length} 个工具函数`);

// 智能解析函数参数和JSDoc注释
function parseFunction(func, funcName) {
    // 从源文件中获取JSDoc注释
    const sourceFile = func._sourceFile;
    const originalName = func._originalName;
    let description = funcName.replace(/_/g, ' '); // 默认使用函数名作为描述
    let paramDescriptions = {};

    if (sourceFile && SOURCE_CACHE[sourceFile]) {
        const sourceCode = SOURCE_CACHE[sourceFile];

        // 查找函数定义和它前面的JSDoc注释（更精确的匹配）
        const lines = sourceCode.split('\n');
        let functionLineIndex = -1;
        let jsdocContent = '';

        // 找到函数定义行
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`async function ${originalName}(`)) {
                functionLineIndex = i;
                break;
            }
        }

        if (functionLineIndex > 0) {
            // 向上查找JSDoc注释
            let jsdocEndIndex = functionLineIndex - 1;
            let jsdocStartIndex = -1;

            // 跳过空行和简单注释
            while (jsdocEndIndex >= 0 && lines[jsdocEndIndex].trim() === '') {
                jsdocEndIndex--;
            }

            // 检查是否是JSDoc结束
            if (jsdocEndIndex >= 0 && lines[jsdocEndIndex].trim() === '*/') {
                // 向上查找JSDoc开始
                for (let i = jsdocEndIndex; i >= 0; i--) {
                    if (lines[i].trim().startsWith('/**')) {
                        jsdocStartIndex = i;
                        break;
                    }
                }

                if (jsdocStartIndex >= 0) {
                    // 提取JSDoc内容
                    jsdocContent = lines.slice(jsdocStartIndex, jsdocEndIndex + 1).join('\n');
                }
            }
        }

        if (jsdocContent) {
            // 提取主描述（第一行非@开头的内容，去除星号）
            const lines = jsdocContent.split('\n');
            let foundDescription = false;
            for (const line of lines) {
                const cleanLine = line.replace(/^\s*\*?\s*/, '').trim();
                // 跳过开始和结束标记
                if (cleanLine && !cleanLine.startsWith('/**') && !cleanLine.startsWith('*/')
                    && !cleanLine.startsWith('@') && !foundDescription) {
                    description = cleanLine;
                    foundDescription = true;
                    break;
                }
            }

            // 提取参数描述
            const paramMatches = jsdocContent.matchAll(/\*\s*@param\s+\{([^}]+)\}\s+(\w+)\s*[-:]?\s*(.+)/g);
            for (const match of paramMatches) {
                const [, type, paramName, paramDesc] = match;
                paramDescriptions[paramName] = {
                    type: type.toLowerCase().includes('string') ? 'string' :
                          type.toLowerCase().includes('number') ? 'number' :
                          type.toLowerCase().includes('boolean') ? 'boolean' : 'string',
                    description: paramDesc.trim()
                };
            }
        }
    }

    // 获取函数参数信息 - 从函数本身或源代码获取
    let paramStr = '';
    const funcStr = func.toString();
    const paramMatch = funcStr.match(/async\s+function\s+\w*\s*\(([^)]*)\)/) || funcStr.match(/\(([^)]*)\)\s*=>/);
    if (paramMatch) {
        paramStr = paramMatch[1].trim();
    }

    // 构建参数描述
    const properties = {};
    const required = [];

    // 特殊处理解构参数 {param1, param2, param3 = defaultValue}
    if (paramStr.startsWith('{') && paramStr.endsWith('}')) {
        // 移除花括号并分割参数
        const innerParams = paramStr.slice(1, -1);
        const destructuredParams = innerParams.split(',').map(p => p.trim()).filter(p => p);

        destructuredParams.forEach(destructParam => {
            const paramName = destructParam.split('=')[0].trim();
            if (paramName && paramName !== '...') {
                const hasDefault = destructParam.includes('=');
                const paramInfo = paramDescriptions[paramName] || {
                    type: "string",
                    description: `参数 ${paramName}`
                };

                properties[paramName] = paramInfo;
                if (!hasDefault) {
                    required.push(paramName);
                }
            }
        });
    } else if (paramStr) {
        // 处理普通参数
        const params = paramStr.split(',').map(p => p.trim()).filter(p => p);
        params.forEach(param => {
            const paramName = param.split('=')[0].trim();
            if (paramName && paramName !== '...') {
                const hasDefault = param.includes('=');
                const paramInfo = paramDescriptions[paramName] || {
                    type: "string",
                    description: `参数 ${paramName}`
                };

                properties[paramName] = paramInfo;
                if (!hasDefault) {
                    required.push(paramName);
                }
            }
        });
    }

    return {
        description,
        properties,
        required
    };
}

// 自动生成 tools 列表
function generateTools() {
    const tools = [];

    for (const [name, func] of Object.entries(FUNCTIONS)) {
        const funcInfo = parseFunction(func, name);

        const tool = {
            type: "function",
            function: {
                name: name,
                description: funcInfo.description,
                parameters: {
                    type: "object",
                    properties: funcInfo.properties,
                    required: funcInfo.required
                }
            }
        };

        tools.push(tool);
    }

    return tools;
}

// Function Call兼容接口 - 保持向后兼容
function getToolDefinitions() {
    return generateTools().map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
    }));
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    const func = FUNCTIONS[name];
    if (!func) {
        throw new Error(`不支持的函数: ${name}`);
    }

    try {
        // 调用函数，支持不同的参数传递方式
        return await func(parameters);
    } catch (error) {
        throw new Error(`执行函数 ${name} 失败: ${error.message}`);
    }
}

module.exports = {
    FUNCTIONS,
    generateTools,
    getToolDefinitions,
    executeFunction
};