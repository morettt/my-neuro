import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'my-neuro',
  description: 'my-neuro WebUI 控制中心使用文档',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'my-neuro',
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    search: { provider: 'local' },
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: '部署', link: '/deploy/install' },
      { text: '配置', link: '/config/open-webui' },
      { text: '插件', link: '/plugins/' },
      { text: '常见问题', link: '/faq' },
      { text: '官网旧教程', link: 'http://mynewbot.com/tutorials' }
    ],
    sidebar: {
      '/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/quick-start' },
            { text: '本站与官网旧教程', link: '/guide/which-docs' }
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
            { text: '制作插件', link: '/plugins/develop' }
          ]
        },
        {
          text: '其他',
          items: [{ text: '常见问题', link: '/faq' }]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/morettt/my-neuro' }
    ],
    footer: {
      message: '本站针对 WebUI 控制中心。肥牛.exe / 旧界面请看官网教程。',
      copyright: 'my-neuro · MIT License'
    }
  }
})
