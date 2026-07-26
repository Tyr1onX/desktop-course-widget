<script setup lang="ts">
import { MotionConfig, motion } from 'motion-v'
import { withBase } from 'vitepress'

const homeLink = withBase('/')
const guideLink = withBase('/guide/getting-started')
const faqLink = withBase('/help/faq')
const developmentLink = withBase('/development/')
const markLink = withBase('/app-icon-v2.svg')
const releaseLink = 'https://github.com/Tyr1onX/desktop-course-widget/releases/latest'
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'

const easeOut = [0.22, 1, 0.36, 1]
const revealViewport = { once: true, amount: 0.28 }
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
            <a href="#day-flow">一天的变化</a>
          </nav>

          <a class="course-nav__download" :href="releaseLink">下载 Windows 版</a>
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
            <h1 id="experience-title">看课刻如何跟着一天变化。</h1>
            <p>这里保留完整的课程状态、日期浏览和时间流动演示。所有组件均直接复用当前桌面端渲染逻辑。</p>
            <div class="course-actions course-actions--center">
              <a class="course-button course-button--primary" :href="releaseLink">下载 Windows 版</a>
              <a class="course-button course-button--text" :href="guideLink">查看使用指南</a>
            </div>
          </motion.div>

          <motion.div
            class="course-stage course-stage--experience"
            aria-label="课刻完整运行状态演示"
            :initial="{ opacity: 0, y: 48, scale: 0.985 }"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :transition="{ duration: 1, delay: 0.18, ease: easeOut }"
          >
            <div class="course-stage__chrome" aria-hidden="true">
              <span>09:42</span>
              <div>
                <span class="course-stage__signal"></span>
                <span class="course-stage__battery"></span>
              </div>
            </div>
            <div class="course-stage__light course-stage__light--one" aria-hidden="true"></div>
            <div class="course-stage__light course-stage__light--two" aria-hidden="true"></div>

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

            <div class="course-stage__dock" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </motion.div>

          <p class="experience-hero__note">可切换上课中、课间等待、今日结束、今天无课、学期未开始和日期浏览。</p>
        </section>

        <section id="day-flow" class="course-story experience-story" aria-labelledby="story-title">
          <motion.div
            class="course-section-heading"
            :initial="{ opacity: 0, y: 34 }"
            :whileInView="{ opacity: 1, y: 0 }"
            :viewport="revealViewport"
            :transition="{ duration: 0.82, ease: easeOut }"
          >
            <p class="course-kicker">一天如何流动</p>
            <h2 id="story-title">早晨看见今天，此刻只看这一课。</h2>
            <p>完整时间线从首页移到这里。滚动时，焦点会依次落到最接近视口中心的真实组件状态。</p>
          </motion.div>

          <div class="day-flow">
            <div class="day-flow__line" aria-hidden="true"><span></span></div>

            <motion.article
              class="day-moment day-moment--morning"
              :initial="{ opacity: 0, y: 46 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.78, ease: easeOut }"
            >
              <div class="day-moment__time">08:12</div>
              <div class="day-moment__visual">
                <p>今天</p><strong>3 节课</strong><span>第一节 08:00 开始</span>
              </div>
              <div class="day-moment__copy">
                <span>早晨</span>
                <h3>今天，从第一节开始。</h3>
                <p>打开电脑，课刻已经把今天排好。你不必先翻完整周课表。</p>
              </div>
            </motion.article>

            <motion.article
              class="day-moment day-moment--current"
              :initial="{ opacity: 0, y: 46, scale: 0.985 }"
              :whileInView="{ opacity: 1, y: 0, scale: 1 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.82, ease: easeOut }"
            >
              <div class="day-moment__time">08:48</div>
              <div class="day-moment__visual day-moment__visual--current">
                <p>计算机网络</p><strong>正在上课</strong><span>还剩 52 分钟</span>
              </div>
              <div class="day-moment__copy">
                <span>此刻</span>
                <h3>这一刻，只看这一课。</h3>
                <p>正在上的课程成为视觉中心；下一节保留在刚好能看见的位置。</p>
              </div>
            </motion.article>

            <motion.article
              class="day-moment day-moment--evening"
              :initial="{ opacity: 0, y: 46 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.78, ease: easeOut }"
            >
              <div class="day-moment__time">18:40</div>
              <div class="day-moment__visual day-moment__visual--quiet">
                <p>今日课程结束</p><strong>明天见。</strong><span>下一次课程已经准备好</span>
              </div>
              <div class="day-moment__copy">
                <span>结束</span>
                <h3>最后一课结束，课刻也安静下来。</h3>
                <p>没有正在发生的课程时，界面退回背景，只留下下一次需要知道的安排。</p>
              </div>
            </motion.article>
          </div>
        </section>

        <motion.section
          class="course-closing experience-closing"
          aria-labelledby="experience-closing-title"
          :initial="{ opacity: 0, y: 34 }"
          :whileInView="{ opacity: 1, y: 0 }"
          :viewport="revealViewport"
          :transition="{ duration: 0.84, ease: easeOut }"
        >
          <img :src="markLink" alt="" width="64" height="64" />
          <h2 id="experience-closing-title">回到桌面，让课刻自己流动。</h2>
          <p>安装后导入或创建课表，组件会根据真实时间自动切换状态。</p>
          <div class="course-actions course-actions--center">
            <a class="course-button course-button--primary" :href="releaseLink">下载 Windows 版</a>
            <a class="course-button course-button--text" :href="homeLink">返回首页</a>
          </div>
        </motion.section>
      </main>

      <footer class="course-footer">
        <div>
          <a class="course-brand course-brand--footer" :href="homeLink">
            <img :src="markLink" alt="" width="24" height="24" />
            <span>课刻</span>
          </a>
          <p>让一天的课程，在桌面上缓慢流动。</p>
        </div>
        <nav aria-label="页脚导航">
          <a :href="guideLink">使用指南</a>
          <a :href="faqLink">常见问题</a>
          <a :href="developmentLink">开发</a>
          <a :href="repositoryLink">GitHub</a>
        </nav>
        <p>MIT License · 本地优先</p>
      </footer>
    </div>
  </MotionConfig>
</template>
