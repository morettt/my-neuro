import { z } from 'zod';

/**
 * 获取当前时间工具
 */
export default {
    name: "get_current_time",
    description: "获取当前时间",
    parameters: z.object({}),
    execute: async () => {
        return new Date().toLocaleString('zh-CN');
    }
};