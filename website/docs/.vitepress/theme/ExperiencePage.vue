<script setup lang="ts">
import { MotionConfig, motion } from 'motion-v'
import { withBase } from 'vitepress'

const homeLink = withBase('/')
const guideLink = withBase('/guide/getting-started')
const faqLink = withBase('/help/faq')
const markLink = withBase('/app-icon-v2.svg')
const stableReleaseLink = 'https://github.com/Tyr1onX/desktop-course-widget/releases/latest'
const betaReleaseLink = 'https://github.com/Tyr1onX/desktop-course-widget/releases/tag/v0.5.0-beta.5'
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'

const easeOut = [0.22, 1, 0.36, 1]
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div class="course-experience">
      <header class="course-nav" aria-label="主导航">
        <div class="course-nav__inner">
          <a class="course-brand" :href="homeLink" aria-label="返回课刻首页">
            <img :src="markLink" alt="" width="28" height="28" />
            <span>课刻</span>
          </a>

          <nav class="course-nav__links" aria-label="页面导航">
            <a :href="homeLink">首页</a>
            <a :href="guideLink">使用指南</a>
            <a :href="faqLink">常见问题</a>
          </nav>

          <a class="course-nav__download" :href="stableReleaseLink">下载稳定版</a>
        </div>
      </header>

      <main id="top">
        <section class="experience-hero" aria-labelledby="experience-title">
          <motion.div
            class="experience-hero__copy"
            :initial="{ opacity: 0, y: 30 }"
            :animate="{ opacity: 1, y: 0 }"
            :transition="{ duration: 0.82, ease: easeOut }"
          >
            <p class="course-kicker">产品体验</p>
            <h1 id="experience-title">
              <span class="experience-title__line">课表不必摊开一整天。</span>
              <span class="experience-title__line">此刻，只看这一课。</span>
            </h1>
            <p class="experience-hero__lead">
              <span>课程会随着时间自然交接，</span>
              <span>下一节也会在需要时来到眼前。</span>
            </p>
            <div class="course-actions course-actions--center">
              <a class="course-button course-button--primary" :href="stableReleaseLink">下载稳定版 v0.4.0</a>
              <a class="course-button course-button--text" :href="guideLink">查看使用指南</a>
              <a class="course-button course-button--text" :href="betaReleaseLink">体验 Beta v0.5.0-beta.5</a>
            </div>
          </motion.div>

          <motion.div
            class="course-stage course-stage--experience"
            aria-label="课刻完整运行状态演示"
            :initial="{ opacity: 0, y: 48, scale: 0.985 }"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :transition="{ duration: 1, delay: 0.18, ease: easeOut }"
          >
            <div class="course-stage__light course-stage__light--one" aria-hidden="true"></div>

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
          </motion.div>

          <div class="experience-capabilities" aria-label="产品能力与运行要求">
            <p class="experience-capabilities__line">
              <a class="experience-capabilities__item" :href="guideLink">Excel 导入</a>
              <a class="experience-capabilities__item" :href="betaReleaseLink">截图识别（Beta）</a>
              <span class="experience-capabilities__item">导入前人工复核</span>
              <span class="experience-capabilities__item">可自由编辑</span>
            </p>
            <p class="experience-capabilities__line">
              <span class="experience-capabilities__item">Windows 10 / 11</span>
              <span class="experience-capabilities__item">免费</span>
              <span class="experience-capabilities__item">无需账号</span>
              <a class="experience-capabilities__item" :href="faqLink">课表只保存在本机</a>
            </p>
          </div>
        </section>
      </main>

      <footer class="course-footer experience-footer">
        <p class="experience-footer__identity">
          <a :href="homeLink">课刻</a>
          <span aria-hidden="true">·</span>
          <span>MIT License</span>
        </p>
        <nav aria-label="页脚导航">
          <a :href="homeLink">首页</a>
          <a :href="guideLink">使用指南</a>
          <a :href="faqLink">常见问题</a>
          <a :href="repositoryLink" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </div>
  </MotionConfig>
</template>
