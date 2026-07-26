type Cleanup = () => void

const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'
const releasesLink = `${repositoryLink}/releases`
const issuesLink = `${repositoryLink}/issues`
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

      <nav class="course-footer__group" aria-label="帮助链接">
        <h3>帮助</h3>
        ${footerLink('使用指南', guideLink)}
        ${footerLink('常见问题', faqLink)}
        ${footerLink('开发文档', developmentLink)}
      </nav>

      <nav class="course-footer__group" aria-label="项目链接">
        <h3>项目</h3>
        ${footerLink('GitHub 仓库', repositoryLink)}
        ${footerLink('版本发布', releasesLink)}
        ${footerLink('问题反馈', issuesLink)}
      </nav>
    </div>

    <div class="course-footer__legal">
      <p>
        ${footerLink('MIT License', licenseLink)}
        <span aria-hidden="true">·</span>
        <span>© 2026 Tyr1onX</span>
        <span aria-hidden="true">·</span>
        ${footerLink('隐私说明', privacyLink)}
      </p>
    </div>
  `

  return () => {
    footer.className = originalClassName
    footer.innerHTML = originalHtml
  }
}
