import { experiencePresets, homepagePresets, type Cleanup } from './website-demo-core'
import { setupExperienceHeroDemo } from './website-demo-experience'
import { setupLegacyHeroDemo, setupStaticHomepageWidget } from './website-demo-hero'
import { setupTrayDemo } from './website-demo-story'

export function setupWebsiteDemo(): Cleanup {
  const root = document.querySelector<HTMLElement>('.course-home, .course-experience')
  if (!root) return () => undefined
  const isExperiencePage = root.classList.contains('course-experience')
  const hasStaticHomepageWidget = !isExperiencePage && Boolean(root.querySelector('.course-stage[data-static-demo="true"]'))
  const heroCleanup = hasStaticHomepageWidget
    ? setupStaticHomepageWidget(root, homepagePresets[0])
    : isExperiencePage
      ? setupExperienceHeroDemo(root, experiencePresets, '完整状态演示')
      : setupLegacyHeroDemo(root, homepagePresets, '当前桌面组件')
  const cleanups = [heroCleanup, setupTrayDemo(root)]
  return () => cleanups.forEach((cleanup) => cleanup())
}
