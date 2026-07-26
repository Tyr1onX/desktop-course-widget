<script setup lang="ts">
import { MotionConfig, motion } from 'motion-v'
import { withBase } from 'vitepress'
import markHdLink from '../../../../src-tauri/icons/128x128@2x.png'

const guideLink = withBase('/guide/getting-started')
const experienceLink = withBase('/experience/')
const markLink = withBase('/app-icon-v2.svg')
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'
const releaseLink = `${repositoryLink}/releases/latest`
const licenseLink = `${repositoryLink}/blob/main/LICENSE`
const privacyLink = `${repositoryLink}/blob/main/PRIVACY.md`

const easeOut = [0.22, 1, 0.36, 1]
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div class="course-home course-home--orbit">
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
              <motion.p
                class="course-kicker"
                :initial="{ opacity: 0, y: 12 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.55, delay: 0.03, ease: easeOut }"
              >
                课刻 · Windows 桌面课表
              </motion.p>

              <motion.h1
                id="hero-title"
                :initial="{ opacity: 0, y: 26 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.78, delay: 0.1, ease: easeOut }"
              >
                <span>让一天的课程，</span>
                <span>静静流过桌面。</span>
              </motion.h1>

              <motion.p
                class="orbit-hero__lead"
                :initial="{ opacity: 0, y: 18 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.66, delay: 0.23, ease: easeOut }"
              >
                看见正在发生的课程，也能随时整理整个学期。
              </motion.p>

              <motion.div
                class="course-actions orbit-hero__actions"
                :initial="{ opacity: 0, y: 15 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.6, delay: 0.34, ease: easeOut }"
              >
                <motion.a
                  class="course-button course-button--primary"
                  :href="releaseLink"
                  :whileHover="{ scale: 1.012 }"
                  :whilePress="{ scale: 0.988 }"
                >
                  下载 Windows 版
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.25 3.5 9.75 8l-4.5 4.5" />
                  </svg>
                </motion.a>
                <a class="course-button course-button--text" :href="experienceLink">深入了解课刻</a>
              </motion.div>

              <motion.p
                class="course-hero__meta orbit-hero__meta"
                :initial="{ opacity: 0 }"
                :animate="{ opacity: 1 }"
                :transition="{ duration: 0.52, delay: 0.46 }"
              >
                Windows 10 / 11 · 免费 · 课表只保存在本机
              </motion.p>
            </div>

            <motion.div
              class="orbit-scene"
              aria-label="课刻主图标、桌面组件与课表编辑窗口概览"
              :initial="{ opacity: 0, x: 34, scale: 0.975 }"
              :animate="{ opacity: 1, x: 0, scale: 1 }"
              :transition="{ duration: 0.95, delay: 0.15, ease: easeOut }"
            >
              <div class="orbit-scene__halo" aria-hidden="true"></div>
              <div class="orbit-scene__ring orbit-scene__ring--outer" aria-hidden="true"></div>
              <div class="orbit-scene__ring orbit-scene__ring--inner" aria-hidden="true"></div>

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
                        <span>一<br /><b>21</b></span>
                        <span class="is-today">二<br /><b>22</b></span>
                        <span>三<br /><b>23</b></span>
                        <span>四<br /><b>24</b></span>
                        <span>五<br /><b>25</b></span>
                      </div>
                      <div class="orbit-settings__grid">
                        <i class="orbit-course orbit-course--blue"><b>通信原理</b><span>B311</span></i>
                        <i class="orbit-course orbit-course--green"><b>数字信号处理</b><span>201</span></i>
                        <i class="orbit-course orbit-course--purple"><b>单片机原理</b><span>B203</span></i>
                      </div>
                    </div>

                    <aside class="orbit-settings__editor">
                      <header><strong>编辑课程</strong><span>×</span></header>
                      <label><span>课程名称</span><b>单片机原理及应用</b></label>
                      <div class="orbit-settings__colors" aria-hidden="true">
                        <i></i><i></i><i></i><i class="is-active"></i><i></i>
                      </div>
                      <label><span>上课时间</span><b>周三 · 1 至 2 节</b></label>
                      <footer><span>取消</span><strong>保存修改</strong></footer>
                    </aside>
                  </div>
                </div>
              </div>

              <motion.div
                class="orbit-mark"
                :animate="{ y: [0, -6, 0] }"
                :transition="{ duration: 7, repeat: Infinity, ease: 'easeInOut' }"
              >
                <img :src="markHdLink" alt="课刻" width="168" height="168" />
              </motion.div>
            </motion.div>
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
  </MotionConfig>
</template>
