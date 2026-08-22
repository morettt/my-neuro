import { defineConfig } from 'vitepress'

const sharedTheme = {
  logo: '/logo.svg',
  outline: { label: '本页目录', level: [2, 3] as [number, number] },
  docFooter: { prev: '上一页', next: '下一页' },
  lastUpdated: { text: '最后更新' },
  search: { provider: 'local' as const },
  socialLinks: [
    { icon: 'github' as const, link: 'https://github.com/morettt/my-neuro' }
  ]
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'my-neuro',
  description: 'my-neuro 使用文档',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: sharedTheme,
  locales: {
    root: {
      label: 'WebUI',
      lang: 'zh-CN',
      link: '/',
      title: 'my-neuro',
      description: 'my-neuro WebUI 控制中心使用文档',
      themeConfig: {
        siteTitle: 'my-neuro',
        nav: [
          { text: '指南', link: '/guide/introduction' },
          { text: '部署', link: '/deploy/install' },
          { text: '配置', link: '/config/open-webui' },
          { text: '插件', link: '/plugins/' },
          { text: '常见问题', link: '/faq' },
          { text: '肥牛.exe', link: '/qt/' },
          { text: '官网旧教程', link: 'http://mynewbot.com/tutorials' }
        ],
        sidebar: {
          '/': [
            {
              text: '指南',
              items: [
                { text: '介绍', link: '/guide/introduction' },
                { text: '快速开始', link: '/guide/quick-start' },
                { text: '三份文档怎么选', link: '/guide/which-docs' }
              ]
            },
            {
              text: '部署',
              items: [
                { text: '环境要求', link: '/deploy/requirements' },
                { text: '安装', link: '/deploy/install' },
                { text: '更新', link: '/deploy/update' }
              ]
            },
            {
              text: '配置',
              items: [
                { text: '打开 WebUI', link: '/config/open-webui' },
                { text: 'LLM 提供商', link: '/config/llm' },
                { text: '人设', link: '/config/persona' },
                { text: '怎么听', link: '/config/listen' },
                { text: '怎么说', link: '/config/speak' },
                { text: '基础配置', link: '/config/basic' },
                { text: '启动服务', link: '/config/start-services' },
                { text: 'Live2D 与皮套', link: '/config/live2d' },
                { text: '第一次对话', link: '/config/first-chat' },
                { text: '控制面板一览', link: '/config/panel' }
              ]
            },
            {
              text: '插件',
              items: [
                { text: '使用插件', link: '/plugins/' },
                { text: '内置插件', link: '/plugins/built-in' },
                { text: '社区插件', link: '/plugins/community' },
                { text: '制作插件', link: '/plugins/develop' }
              ]
            },
            {
              text: '其他',
              items: [{ text: '常见问题', link: '/faq' }]
            }
          ]
        },
        footer: {
          message: '浏览器控制中心看本站；肥牛.exe 看肥牛.exe 教程。',
          copyright: 'my-neuro · MIT License'
        }
      }
    },
    qt: {
      label: '肥牛.exe',
      lang: 'zh-CN',
      link: '/qt/',
      title: '肥牛.exe',
      description: 'my-neuro 肥牛.exe（Qt）使用文档',
      themeConfig: {
        siteTitle: '肥牛.exe',
        nav: [
          { text: '指南', link: '/qt/guide/introduction' },
          { text: '开始用', link: '/qt/deploy/download' },
          { text: '配置', link: '/qt/config/open-qt' },
          { text: '插件', link: '/qt/plugins/' },
          { text: '常见问题', link: '/qt/faq' },
          { text: 'WebUI 文档', link: '/' }
        ],
        sidebar: {
          '/qt/': [
            {
              text: '指南',
              items: [
                { text: '介绍', link: '/qt/guide/introduction' },
                { text: '快速开始', link: '/qt/guide/quick-start' },
                { text: '三份文档怎么选', link: '/qt/guide/which-docs' }
              ]
            },
            {
              text: '开始用',
              items: [
                { text: '下载与打开', link: '/qt/deploy/download' },
                { text: '认识肥牛.exe', link: '/qt/config/open-qt' }
              ]
            },
            {
              text: '配置',
              items: [
                { text: 'LLM 四件套', link: '/qt/config/llm' },
                { text: '怎么听', link: '/qt/config/listen' },
                { text: '怎么说', link: '/qt/config/speak' },
                { text: '记忆', link: '/qt/config/memory' },
                { text: '截图（BERT）', link: '/qt/config/vision' },
                { text: '全云端体验', link: '/qt/config/cloud' },
                { text: '界面与打断', link: '/qt/config/ui' },
                { text: '皮套与动作', link: '/qt/config/live2d' }
              ]
            },
            {
              text: '插件',
              items: [
                { text: '在肥牛.exe 里用插件', link: '/qt/plugins/' }
              ]
            },
            {
              text: '其他',
              items: [{ text: '常见问题', link: '/qt/faq' }]
            }
          ]
        },
        footer: {
          message: '本站针对肥牛.exe（Qt 桌面窗口）。浏览器控制中心请看 WebUI 文档。',
          copyright: 'my-neuro · MIT License'
        }
      }
    }
  }
})
