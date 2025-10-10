import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import axios from 'axios';
import { readdir } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = new FastMCP({
  name: "AutoLoadMCPServer",
  version: "2.0.0",
});

// 自动加载工具函数
async function loadAllTools() {
  const toolsDir = join(__dirname, 'tools');
  let loadedCount = 0;

  try {
    const files = await readdir(toolsDir);
    const toolFiles = files.filter(file => extname(file) === '.js');

    console.log(`🔍 发现 ${toolFiles.length} 个MCP工具文件`);

    for (const file of toolFiles) {
      try {
        const filePath = join(toolsDir, file);
        const module = await import(`file://${filePath}`);

        if (!module.default || typeof module.default !== 'object') {
          console.warn(`⚠️ ${file}: 缺少默认导出对象`);
          continue;
        }

        const toolConfig = module.default;

        if (!toolConfig.name || !toolConfig.description || !toolConfig.execute) {
          console.warn(`⚠️ ${file}: 缺少必需字段 (name, description, execute)`);
          continue;
        }

        if (typeof toolConfig.execute !== 'function') {
          console.warn(`⚠️ ${file}: execute必须是函数`);
          continue;
        }

        server.addTool({
          name: toolConfig.name,
          description: toolConfig.description,
          parameters: toolConfig.parameters || z.object({}),
          execute: toolConfig.execute
        });

        console.log(`📦 加载工具: ${toolConfig.name} (${file})`);
        loadedCount++;

      } catch (error) {
        console.error(`❌ 加载工具文件 ${file} 失败:`, error.message);
      }
    }

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('📁 tools文件夹不存在，跳过工具加载');
    } else {
      console.error('❌ 扫描tools文件夹失败:', error);
    }
  }

  return loadedCount;
}

// 初始化服务器
async function initializeServer() {
  console.log('🚀 启动MCP服务器...');

  try {
    const toolCount = await loadAllTools();
    console.log(`📊 总共加载了 ${toolCount} 个MCP工具`);

    server.start({
      transportType: "stdio",
    });

  } catch (error) {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
initializeServer();