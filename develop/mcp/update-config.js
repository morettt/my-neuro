import { readdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 自动扫描 tools 文件夹并更新 mcp_config.json
 * 模仿 js_mcp 的自动配置同步机制
 */
function updateMCPConfig() {
  const toolsDir = join(__dirname, 'tools');
  const configPath = join(__dirname, 'mcp_config.json');

  console.log('🔍 开始扫描 tools 文件夹...');

  if (!existsSync(toolsDir)) {
    console.log('⚠️  tools 文件夹不存在');
    return;
  }

  // 读取现有配置
  let config = {};
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
      console.log('📋 已读取现有配置文件');
    } catch (error) {
      console.warn('⚠️  配置文件解析失败,将创建新配置:', error.message);
      config = {};
    }
  }

  // 保存非 tools/ 路径的配置(如 tavily 等外部服务)
  const externalConfigs = {};
  Object.keys(config).forEach(key => {
    const cfg = config[key];
    // 如果不是指向 tools/ 的配置,保留它
    if (!cfg.args || !Array.isArray(cfg.args) || !cfg.args[0]?.includes('tools/')) {
      externalConfigs[key] = cfg;
    }
  });

  // 扫描 tools 文件夹中的所有文件
  const items = readdirSync(toolsDir);
  const toolConfigs = {};

  items.forEach(item => {
    const itemPath = join(toolsDir, item);
    const stat = statSync(itemPath);

    if (stat.isFile()) {
      let toolName, command, args;

      if (item.endsWith('.js')) {
        // JavaScript 工具
        toolName = item.replace('.js', '');
        command = 'node';
        args = [`./mcp/tools/${item}`];
      } else if (item.endsWith('.py')) {
        // Python 工具
        toolName = item.replace('.py', '');
        command = 'python';
        args = [`./mcp/tools/${item}`];
      } else {
        return; // 跳过其他类型文件
      }

      toolConfigs[toolName] = {
        command: command,
        args: args
      };

      console.log(`📦 发现工具: ${toolName} (${command})`);
    }
  });

  // 合并配置: 先放外部服务,再放工具
  const finalConfig = {
    ...externalConfigs,
    ...toolConfigs
  };

  // 写回配置文件
  writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), 'utf8');

  console.log(`\n✅ 配置更新完成!`);
  console.log(`   - 外部服务: ${Object.keys(externalConfigs).length} 个`);
  console.log(`   - 本地工具: ${Object.keys(toolConfigs).length} 个`);
  console.log(`   - 总计: ${Object.keys(finalConfig).length} 个服务器`);

  if (Object.keys(externalConfigs).length > 0) {
    console.log(`   外部服务列表: ${Object.keys(externalConfigs).join(', ')}`);
  }
  if (Object.keys(toolConfigs).length > 0) {
    console.log(`   本地工具列表: ${Object.keys(toolConfigs).join(', ')}`);
  }
}

// 运行自动更新
updateMCPConfig();
