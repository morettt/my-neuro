import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import axios from 'axios';
import { exec } from 'child_process'; // 添加这个导入
/**
 * 随机二次元图片工具 MCP 服务器
 * 提供获取随机二次元图片的功能
 */
const server = new FastMCP({
  name: "ACGPicServer",
  version: "1.0.0",
});

server.addTool({
  name: "get_random_acg_pic",
  description: "获取随机二次元图片",
  parameters: z.object({
    type: z.enum(['pc', 'wap']).optional().default('pc').describe('图片类型: pc(电脑端) 或 wap(手机端)')
  }),
  execute: async ({ type = 'pc' }) => {
    try {
      const response = await axios.get(`https://v2.xxapi.cn/api/randomAcgPic?type=${type}`);
      return response.data.data;
    } catch (error) {
      return `⚠️ 获取图片失败: ${error.message}`;
    }
  }
});

// 👇 添加新的一体化功能
server.addTool({
  name: "get_and_show_acg_pic",
  description: "获取随机二次元图片并在浏览器中打开",
  parameters: z.object({
    type: z.enum(['pc', 'wap']).optional().default('pc').describe('图片类型: pc(电脑端) 或 wap(手机端)'),
    browser: z.enum(['default', 'chrome', 'firefox', 'edge']).optional().default('default').describe('指定浏览器类型')
  }),
  execute: async ({ type = 'pc', browser = 'default' }) => {
    try {
      // 第一步：获取随机二次元图片
      console.log('正在获取随机二次元图片...');
      const imageResponse = await axios.get(`https://v2.xxapi.cn/api/randomAcgPic?type=${type}`);
      const imageUrl = imageResponse.data.data;
      if (!imageUrl || typeof imageUrl !== 'string') {
          return '❌ 未能获取到有效的图片数据';
      }
      
      console.log(`获取到图片URL: ${imageUrl}`);

      // 第二步：在浏览器中打开图片
      console.log('正在浏览器中打开图片...');
      let command;
      
      // 根据操作系统和浏览器类型构建命令
      if (process.platform === 'win32') {
        switch (browser) {
          case 'chrome':
            command = `start chrome "${imageUrl}"`;
            break;
          case 'firefox':
            command = `start firefox "${imageUrl}"`;
            break;
          case 'edge':
            command = `start msedge "${imageUrl}"`;
            break;
          default:
            command = `start "" "${imageUrl}"`;
        }
      } else if (process.platform === 'darwin') {
        command = `open "${imageUrl}"`;
      } else {
        command = `xdg-open "${imageUrl}"`;
      }

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`执行命令出错: ${error}`);
          return `❌ 打开浏览器失败: ${error.message}`;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
      });

      // 返回成功信息
      return {
        status: 'success',
        message: `✅ 已在${browser === 'default' ? '默认浏览器' : browser}中打开二次元图片`,
        imageUrl: imageUrl,
        imageInfo: imageData
      };

    } catch (error) {
      console.error('工具执行失败:', error);
      return `⚠️ 操作失败: ${error.message}`;
    }
  }
});

server.start({
  transportType: "stdio",
});
