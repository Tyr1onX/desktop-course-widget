<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import markHdLink from '../../../../src-tauri/icons/128x128@2x.png'

const guideLink = withBase('/guide/getting-started')
const experienceLink = withBase('/experience/')
const markLink = withBase('/app-icon-v2.svg')
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'
const releaseLink = `${repositoryLink}/releases/latest`
const licenseLink = `${repositoryLink}/blob/main/LICENSE`
const privacyLink = `${repositoryLink}/blob/main/PRIVACY.md`

const homeRoot = ref<HTMLElement | null>(null)
const introStorageKey = 'course-home:first-mark:v1'

onMounted(() => {
  const root = homeRoot.value
  if (!root) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('is-motion-reduced')
    return
  }

  let hasSeenIntro = false
  try {
    hasSeenIntro = window.sessionStorage.getItem(introStorageKey) === '1'
    if (!hasSeenIntro) window.sessionStorage.setItem(introStorageKey, '1')
  } catch {
    // Storage can be unavailable in strict privacy modes; the page still works normally.
  }

  window.requestAnimationFrame(() => {
    root.classList.add(hasSeenIntro ? 'is-returning' : 'is-intro-playing')
  })
})
</script>

<template>
  <div ref="homeRoot" class="course-home course-home--orbit">
    <header class="course-nav" aria-label="主导航">
      <div class="course-nav__inner">
        <a class="course-brand" href="#top" aria-label="课刻首页">
          <img :src="markLink" alt="" width="28" height="28" />
          <span>课刻</span>
        </a>

        <nav class="course-nav__links" aria-label="页面导航">
          <a :href="experienceLink">产品体验</a>
          <a :href="guideLink">使用指南</a>
          <a :href="repositoryLink" target="_blank" rel="noreferrer">GitHub</a>
        </nav>

        <a class="course-nav__download" :href="releaseLink">下载 Windows 版</a>
      </div>
    </header>

    <main id="top" class="orbit-home-main">
      <section class="orbit-hero" aria-labelledby="hero-title">
        <div class="orbit-hero__inner">
          <div class="orbit-hero__copy">
            <p class="course-kicker">课刻 · Windows 桌面课表</p>

            <h1 id="hero-title">
              <span>让一天的课程，</span>
              <span>静静流过桌面。</span>
            </h1>

            <p class="orbit-hero__lead">看见正在发生的课程，也能随时整理整个学期。</p>

            <div class="course-actions orbit-hero__actions">
              <a class="course-button course-button--primary" :href="releaseLink">
                下载 Windows 版
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.25 3.5 9.75 8l-4.5 4.5" />
                </svg>
              </a>
              <a class="course-button course-button--text" :href="experienceLink">深入了解课刻</a>
            </div>

            <p class="course-hero__meta orbit-hero__meta">Windows 10 / 11 · 免费 · 课表只保存在本机</p>
          </div>

          <div class="orbit-scene" aria-label="课刻主图标、桌面组件与课表编辑窗口概览">
            <div class="orbit-scene__halo" aria-hidden="true"></div>
            <div class="orbit-scene__ring orbit-scene__ring--outer" aria-hidden="true"></div>
            <div class="orbit-scene__ring orbit-scene__ring--inner" aria-hidden="true"></div>

            <svg
              class="orbit-first-mark"
              viewBox="0 0 800 560"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <ellipse class="orbit-first-mark__track" cx="384" cy="252" rx="252" ry="146" pathLength="1" />
              <ellipse class="orbit-first-mark__stroke" cx="384" cy="252" rx="252" ry="146" pathLength="1" />
            </svg>

            <div class="orbit-float orbit-float--widget">
              <div
                class="course-stage course-stage--orbit"
                data-static-demo="true"
                aria-label="课刻桌面组件代表状态"
              >
                <div class="widget-window">
                  <div class="widget-window__top">
                    <div><p>星期一</p><strong>9月21日</strong></div>
                    <span>第 3 周</span>
                  </div>
                  <div class="widget-now"><span class="widget-now__dot"></span><span>现在 · 08:48</span></div>
                  <div class="widget-course widget-course--active">
                    <div class="widget-course__time"><strong>08:00</strong><span>09:40</span></div>
                    <div class="widget-course__line" aria-hidden="true"><span></span></div>
                    <div class="widget-course__content"><span>正在上课</span><strong>计算机网络</strong><p>教学楼 A101</p></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="orbit-float orbit-float--settings">
              <div class="orbit-settings" aria-label="课刻课表编辑窗口概览">
                <div class="orbit-settings__titlebar" aria-hidden="true">
                  <span>课表与设置</span>
                  <div><i></i><i></i><i></i></div>
                </div>

                <div class="orbit-settings__toolbar" aria-hidden="true">
                  <strong>2026 秋季学期</strong>
                  <span>‹</span><b>第 3 教学周</b><span>›</span>
                  <em>＋</em>
                </div>

                <div class="orbit-settings__body">
                  <div class="orbit-settings__calendar" aria-hidden="true">
                    <div class="orbit-settings__days">
                      <span><small>一</small><b>21</b></span>
                      <span class="is-today"><small>二</small><b>22</b></span>
                      <span><small>三</small><b>23</b></span>
                      <span><small>四</small><b>24</b></span>
                      <span><small>五</small><b>25</b></span>
                    </div>
                    <div class="orbit-settings__grid">
                      <i class="orbit-course orbit-course--blue" style="--day:1;--start:1;--span:2"><b>通信原理</b><span>B311</span></i>
                      <i class="orbit-course orbit-course--green" style="--day:2;--start:2;--span:2"><b>数字信号处理</b><span>201</span></i>
                      <i class="orbit-course orbit-course--purple" style="--day:3;--start:1;--span:2"><b>单片机原理</b><span>B203</span></i>
                    </div>
                  </div>

                  <aside class="orbit-settings__editor">
                    <header><strong>编辑课程</strong><span>×</span></header>
                    <div class="orbit-settings__editor-content">
                      <label><span>课程名称</span><b>单片机原理及应用</b></label>
                      <div class="orbit-settings__colors" aria-hidden="true">
                        <i></i><i></i><i></i><i class="is-active"></i><i></i>
                      </div>
                      <label><span>上课时间</span><b>周三 · 1 至 2 节</b></label>
                    </div>
                    <footer><span>取消</span><strong>保存修改</strong></footer>
                  </aside>
                </div>
              </div>
            </div>

            <div class="orbit-mark">
              <img :src="markHdLink" alt="课刻" width="168" height="168" />
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="course-footer course-footer--home-legal">
      <p>
        <span>课刻</span>
        <span aria-hidden="true">·</span>
        <a :href="licenseLink" target="_blank" rel="noreferrer">MIT License</a>
        <span aria-hidden="true">·</span>
        <span>© 2026 Tyr1onX</span>
      </p>
      <nav aria-label="法律与项目链接">
        <a :href="privacyLink" target="_blank" rel="noreferrer">隐私说明</a>
        <a :href="repositoryLink" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </footer>
  </div>
</template>
