import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: '课刻',
  description: '让一天的课程，在桌面上缓慢流动的 Windows 桌面课表。',
  base: '/desktop-course-widget/',
  cleanUrls: true,
  head: [
    ['meta', { name: 'theme-color', content: '#f6f7fb' }],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/desktop-course-widget/app-icon-v2.svg',
      },
    ],
  ],
  vite: {
    resolve: {
      alias: {
        '@tauri-apps/api': fileURLToPath(new URL('../../node_modules/@tauri-apps/api', import.meta.url)),
      },
    },
    server: {
      fs: {
        allow: [fileURLToPath(new URL('../../..', import.meta.url))],
      },
    },
  },
  themeConfig: {
    logo: '/app-icon-v2.svg',
    siteTitle: '课刻',
    nav: [
      { text: '首页', link: '/' },
      { text: '产品体验', link: '/experience/' },
      { text: '使用指南', link: '/guide/getting-started' },
      { text: '常见问题', link: '/help/faq' },
      { text: '开发', link: '/development/' },
      {
        text: '下载课刻',
        link: 'https://github.com/Tyr1onX/desktop-course-widget/releases/latest',
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '下载与首次使用', link: '/guide/getting-started' },
            { text: '课表与课程管理', link: '/guide/schedule-management' },
          ],
        },
      ],
      '/help/': [
        {
          text: '帮助',
          items: [{ text: '常见问题', link: '/help/faq' }],
        },
      ],
      '/development/': [
        {
          text: '开发',
          items: [{ text: '本地开发', link: '/development/' }],
        },
      ],
    },
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/Tyr1onX/desktop-course-widget',
      },
    ],
    footer: {
      message: '课刻本地优先，不上传课表数据。',
      copyright: 'Released under the MIT License.',
    },
    search: {
      provider: 'local',
    },
    outline: {
      level: [2, 3],
      label: '本页内容',
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },
    lastUpdated: {
      text: '最后更新于',
    },
  },
})
