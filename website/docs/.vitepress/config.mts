import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitepress'

const siteBase = '/desktop-course-widget/'
const siteUrl = `https://tyr1onx.github.io${siteBase}`
const socialImageUrl = `${siteUrl}social-preview.png`

function pageUrl(page: string): string {
  const route = page.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
  return new URL(route, siteUrl).href
}

export default defineConfig({
  lang: 'zh-CN',
  title: '课刻',
  description:
    '课刻是一款免费的 Windows 桌面课表工具，支持 Excel 导入；Beta 版可在本机识别课表截图并复核后导入，所有课表数据仅保存在本机。',
  base: siteBase,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: siteUrl,
  },
  head: [
    ['meta', { name: 'theme-color', content: '#f5f5f7' }],
    ['meta', { name: 'application-name', content: '课刻' }],
    [
      'meta',
      {
        name: 'keywords',
        content: 'Windows课表,桌面课表,大学生课表,课程表,课表组件,Excel课表导入,课表截图识别,Tauri,Rust',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: `${siteBase}app-icon-v2.svg`,
      },
    ],
  ],
  transformHead({ title, description, page }) {
    if (page === '404.md') {
      return [['meta', { name: 'robots', content: 'noindex, nofollow' }]]
    }

    const canonicalUrl = pageUrl(page)
    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:locale', content: 'zh_CN' }],
      ['meta', { property: 'og:site_name', content: '课刻' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:image', content: socialImageUrl }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '1280' }],
      ['meta', { property: 'og:image:height', content: '640' }],
      ['meta', { property: 'og:image:alt', content: '课刻 Windows 桌面课表' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: socialImageUrl }],
    ]
  },
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
        text: '下载稳定版',
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
