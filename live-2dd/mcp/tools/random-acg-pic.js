import { z } from 'zod';
import axios from 'axios';

/**
 * 获取随机二次元图片工具
 * 从原来的server.js迁移过来
 */
export default {
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
};