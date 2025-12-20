import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import axios from 'axios';

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

server.start({
  transportType: "stdio",
});
