const fs = require('fs');
const path = require('path');

/**
 * Live2D 模型路径更新器
 * 负责扫描 2D 文件夹中的模型文件，并自动更新 app.js 中的模型路径
 */
class ModelPathUpdater {
    constructor(appPath, priorityFolders = ['肥牛', 'Hiyouri', 'Default', 'Main']) {
        this.appPath = appPath;
        this.modelDir = path.join(appPath, '2D');
        this.modelSetupJsPath = path.join(appPath, 'js', 'model', 'model-setup.js');
        // 优先级文件夹列表（从外部传入，支持动态配置）
        this.priorityFolders = priorityFolders;
    }

    /**
     * 更新 Live2D 模型路径
     */
    update() {
        console.log('开始更新Live2D模型路径...');

        // 检查2D文件夹是否存在
        if (!fs.existsSync(this.modelDir)) {
            console.log('2D文件夹不存在，不进行更新');
            return;
        }

        try {
            // 扫描所有模型文件
            const modelFiles = this._scanModelFiles();

            if (modelFiles.length === 0) {
                console.log('2D文件夹中没有找到.model3.json文件，不进行更新');
                return;
            }

            // 选择优先级最高的模型
            const selectedModelFile = this._selectPriorityModel(modelFiles);

            console.log(`所有找到的模型: ${modelFiles.join(', ')}`);
            console.log(`最终选择模型: ${selectedModelFile}`);

            // 更新 app.js 文件
            this._updateAppJs(selectedModelFile);

        } catch (err) {
            console.error('更新Live2D模型路径时出错:', err);
        }
    }

    /**
     * 递归扫描 2D 文件夹中的所有 .model3.json 文件
     * @returns {string[]} 模型文件路径数组
     */
    _scanModelFiles() {
        const modelFiles = [];

        const scanForModels = (dir, basePath = '') => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const relativePath = basePath ? path.join(basePath, item) : item;

                if (fs.statSync(fullPath).isDirectory()) {
                    // 如果是文件夹，递归扫描
                    scanForModels(fullPath, relativePath);
                } else if (item.endsWith('.model3.json')) {
                    // 找到模型文件
                    const modelPath = path.join('2D', relativePath).replace(/\\/g, '/');
                    modelFiles.push(modelPath);
                }
            }
        };

        scanForModels(this.modelDir);
        return modelFiles;
    }

    /**
     * 根据优先级选择模型文件
     * @param {string[]} modelFiles 所有模型文件路径
     * @returns {string} 选中的模型文件路径
     */
    _selectPriorityModel(modelFiles) {
        // 先在优先文件夹中找
        for (const priority of this.priorityFolders) {
            const priorityModel = modelFiles.find(file => file.includes(`2D/${priority}/`));
            if (priorityModel) {
                console.log(`找到优先模型: ${priorityModel}`);
                return priorityModel;
            }
        }

        // 如果优先文件夹没找到，就按字母排序取第一个
        modelFiles.sort();
        const selectedModel = modelFiles[0];
        console.log(`使用默认模型: ${selectedModel}`);
        return selectedModel;
    }

    /**
     * 更新 js/model-setup.js 文件中的模型路径
     * @param {string} modelPath 模型文件路径
     */
    _updateAppJs(modelPath) {
        // 读取 model-setup.js 文件
        let jsContent = fs.readFileSync(this.modelSetupJsPath, 'utf8');

        // 查找并替换模型路径
        const pattern = /const model = await PIXI\.live2d\.Live2DModel\.from\("([^"]*)"\);/;
        const replacement = `const model = await PIXI.live2d.Live2DModel.from("${modelPath}");`;

        if (pattern.test(jsContent)) {
            // 替换匹配到的内容
            jsContent = jsContent.replace(pattern, replacement);

            // 写回文件
            fs.writeFileSync(this.modelSetupJsPath, jsContent, 'utf8');
            console.log(`成功更新model-setup.js文件中的模型路径为: ${modelPath}`);
        } else {
            console.log('在model-setup.js中没有找到匹配的模型加载代码行');
        }
    }
}

module.exports = { ModelPathUpdater };
