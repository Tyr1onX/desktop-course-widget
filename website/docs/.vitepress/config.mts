import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  lang: 'zh-CN',
  title: '桌面课表',
  description: '让一天的课程，在桌面上缓慢流动。',
  base: '/desktop-course-widget/',
  cleanUrls: true,
  head: [
    ['meta', { name: 'theme-color', content: '#f6f7fb' }],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/png',
        href: '/desktop-course-widget/app-icon.png',
      },
    ],
  ],
  vite: {
    plugins: [
      {
        name: 'desktop-course-widget-brand-assets',
        buildStart() {
          const source = readFileSync(
            resolve(currentDirectory, '../../../src-tauri/icons/128x128.png'),
          )

          this.emitFile({
            type: 'asset',
            fileName: 'app-icon.png',
            source,
          })
        },
      },
    ],
  },
  themeConfig: {
    logo: '/app-icon.png',
    siteTitle: '桌面课表',
    nav: [
      { text: '首页', link: '/' },
      { text: '使用指南', link: '/guide/getting-started' },
      { text: '常见问题', link: '/help/faq' },
      { text: '开发', link: '/development/' },
      {
        text: '下载',
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
      message: '本地优先，不上传课表数据。',
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
