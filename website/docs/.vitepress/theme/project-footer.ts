type Cleanup = () => void

const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'
const releasesLink = `${repositoryLink}/releases`
const issuesLink = `${repositoryLink}/issues`
const changelogLink = `${repositoryLink}/blob/main/CHANGELOG.md`
const privacyLink = `${repositoryLink}/blob/main/PRIVACY.md`
const licenseLink = `${repositoryLink}/blob/main/LICENSE`

function existingLink(footer: HTMLElement, label: string, fallback: string): string {
  const link = Array.from(footer.querySelectorAll<HTMLAnchorElement>('a'))
    .find((item) => item.textContent?.trim() === label)
  return link?.href ?? fallback
}

function externalAttributes(href: string): string {
  return href.startsWith('http') ? ' target="_blank" rel="noreferrer"' : ''
}

function footerLink(label: string, href: string): string {
  return `<a href="${href}"${externalAttributes(href)}>${label}</a>`
}

export function setupProjectFooter(): Cleanup {
  const footer = document.querySelector<HTMLElement>('.course-footer')
  if (!footer) return () => undefined

  const originalClassName = footer.className
  const originalHtml = footer.innerHTML
  const markSource = footer.querySelector<HTMLImageElement>('img')?.src ?? ''
  const guideLink = existingLink(footer, '使用指南', './guide/getting-started')
  const faqLink = existingLink(footer, '常见问题', './help/faq')
  const developmentLink = existingLink(footer, '开发', './development/')

  footer.className = `${originalClassName} course-footer--project`
  footer.innerHTML = `
    <div class="course-footer__content">
      <div class="course-footer__brand-block">
        <a class="course-footer__brand" href="#top" aria-label="返回课刻首页顶部">
          ${markSource ? `<img src="${markSource}" alt="" width="38" height="38" />` : ''}
          <span>课刻</span>
        </a>
        <p>把正在发生的课程，放在桌面上刚好能看见的位置。</p>
        <span class="course-footer__identity">Windows 桌面课表 · 本地优先 · 开放源代码</span>
      </div>

      <nav class="course-footer__group" aria-label="使用链接">
        <h3>使用</h3>
        ${footerLink('使用指南', guideLink)}
        ${footerLink('常见问题', faqLink)}
        ${footerLink('下载课刻', `${releasesLink}/latest`)}
      </nav>

      <nav class="course-footer__group" aria-label="项目链接">
        <h3>项目</h3>
        ${footerLink('GitHub', repositoryLink)}
        ${footerLink('版本发布', releasesLink)}
        ${footerLink('问题反馈', issuesLink)}
      </nav>

      <nav class="course-footer__group" aria-label="关于链接">
        <h3>关于</h3>
        ${footerLink('开发文档', developmentLink)}
        ${footerLink('更新日志', changelogLink)}
        ${footerLink('隐私说明', privacyLink)}
      </nav>
    </div>

    <div class="course-footer__legal">
      <p>
        课刻以 ${footerLink('MIT License', licenseLink)} 开源。
        <span>© 2026 Tyr1onX</span>
        <span aria-hidden="true">·</span>
        ${footerLink('隐私', privacyLink)}
      </p>
      <a class="course-footer__github" href="${repositoryLink}" target="_blank" rel="noreferrer" aria-label="在 GitHub 查看课刻源码">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.75a9.5 9.5 0 0 0-3 18.51c.48.09.65-.21.65-.46v-1.68c-2.66.58-3.22-1.13-3.22-1.13-.43-1.1-1.06-1.39-1.06-1.39-.87-.59.07-.58.07-.58.96.07 1.46.99 1.46.99.85 1.46 2.24 1.04 2.79.8.09-.62.33-1.04.61-1.28-2.12-.24-4.35-1.06-4.35-4.7 0-1.04.37-1.89.98-2.56-.1-.24-.43-1.21.09-2.52 0 0 .8-.26 2.61.98A9.08 9.08 0 0 1 12 7.41a9.1 9.1 0 0 1 2.38.32c1.81-1.24 2.61-.98 2.61-.98.52 1.31.19 2.28.09 2.52.61.67.98 1.52.98 2.56 0 3.65-2.24 4.45-4.37 4.69.34.3.65.88.65 1.78v2.5c0 .25.17.55.66.46A9.5 9.5 0 0 0 12 2.75Z" />
        </svg>
      </a>
    </div>
  `

  return () => {
    footer.className = originalClassName
    footer.innerHTML = originalHtml
  }
}
