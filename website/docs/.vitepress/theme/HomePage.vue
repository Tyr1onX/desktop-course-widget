<script setup lang="ts">
import { MotionConfig, motion } from 'motion-v'
import { withBase } from 'vitepress'

const guideLink = withBase('/guide/getting-started')
const experienceLink = withBase('/experience/')
const faqLink = withBase('/help/faq')
const developmentLink = withBase('/development/')
const markLink = withBase('/app-icon-v2.svg')
const releaseLink = 'https://github.com/Tyr1onX/desktop-course-widget/releases/latest'
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'

const easeOut = [0.22, 1, 0.36, 1]
const revealInitial = { opacity: 0, y: 34 }
const revealTarget = { opacity: 1, y: 0 }
const revealViewport = { once: true, amount: 0.32 }
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div class="course-home">
      <header class="course-nav" aria-label="主导航">
        <div class="course-nav__inner">
          <a class="course-brand" href="#top" aria-label="课刻首页">
            <img :src="markLink" alt="" width="28" height="28" />
            <span>课刻</span>
          </a>

          <nav class="course-nav__links" aria-label="页面导航">
            <a :href="experienceLink">产品体验</a>
            <a href="#privacy">隐私</a>
            <a :href="guideLink">使用指南</a>
          </nav>

          <a class="course-nav__download" :href="releaseLink">下载 Windows 版</a>
        </div>
      </header>

      <main id="top">
        <section class="course-hero" aria-labelledby="hero-title">
          <div class="course-hero__copy">
            <motion.p
              class="course-kicker"
              :initial="{ opacity: 0, y: 14 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ duration: 0.62, delay: 0.05, ease: easeOut }"
            >
              课刻 · Windows 桌面课表
            </motion.p>
            <motion.h1
              id="hero-title"
              :initial="{ opacity: 0, y: 28 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ duration: 0.82, delay: 0.13, ease: easeOut }"
            >
              让一天的课程，<br />静静流过桌面。
            </motion.h1>
            <motion.p
              class="course-hero__lead"
              :initial="{ opacity: 0, y: 22 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ duration: 0.72, delay: 0.28, ease: easeOut }"
            >
              课刻把正在上的课、下一节和今天剩下的安排，放在抬眼就能看见的位置。
            </motion.p>
            <motion.div
              class="course-actions"
              :initial="{ opacity: 0, y: 18 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ duration: 0.65, delay: 0.4, ease: easeOut }"
            >
              <motion.a
                class="course-button course-button--primary"
                :href="releaseLink"
                :whileHover="{ scale: 1.015 }"
                :whilePress="{ scale: 0.985 }"
              >
                下载 Windows 版
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.25 3.5 9.75 8l-4.5 4.5" />
                </svg>
              </motion.a>
              <a class="course-button course-button--text" :href="guideLink">查看安装与使用指南</a>
            </motion.div>
            <motion.p
              class="course-hero__meta"
              :initial="{ opacity: 0 }"
              :animate="{ opacity: 1 }"
              :transition="{ duration: 0.6, delay: 0.52 }"
            >
              Windows 10 / 11 · 免费 · 课表只保存在本机
            </motion.p>
          </div>

          <motion.div
            class="course-stage"
            aria-label="课刻桌面组件真实状态演示"
            :initial="{ opacity: 0, y: 58, scale: 0.975 }"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :transition="{ duration: 1.05, delay: 0.35, ease: easeOut }"
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

            <motion.div
              class="widget-window"
              :animate="{ y: [0, -6, 0] }"
              :transition="{ duration: 7, repeat: Infinity, ease: 'easeInOut' }"
            >
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
            </motion.div>

            <div class="course-stage__dock" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </motion.div>

          <motion.div
            class="course-stage-caption course-stage-caption--with-link"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :transition="{ duration: 0.7, delay: 1.05 }"
          >
            <span>课刻不让你多打开一个页面，只让你少记住一件事。</span>
            <a :href="experienceLink">查看完整状态演示</a>
          </motion.div>
        </section>

        <section class="course-focus" aria-labelledby="focus-title">
          <div class="course-focus__inner">
            <motion.div
              class="course-focus__copy"
              :initial="revealInitial"
              :whileInView="revealTarget"
              :viewport="revealViewport"
              :transition="{ duration: 0.82, ease: easeOut }"
            >
              <p class="course-kicker course-kicker--light">不是窗口，是桌面的一部分</p>
              <h2 id="focus-title">需要时看见，不需要时隐去。</h2>
              <p>课刻随 Windows 启动，关闭后回到系统托盘。位置、缩放与显示习惯都会被记住。</p>
              <a :href="guideLink">查看首次使用指南</a>
            </motion.div>

            <motion.div
              class="course-focus__visual"
              aria-hidden="true"
              :initial="{ opacity: 0, x: 52, rotateY: 5 }"
              :whileInView="{ opacity: 1, x: 0, rotateY: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.95, ease: easeOut }"
            >
              <div class="focus-desktop">
                <div class="focus-desktop__widget">
                  <div><span>下一节</span><strong>通信原理</strong></div>
                  <p>10:50 · 教学楼 A101</p>
                </div>
                <div class="focus-desktop__cursor"></div>
                <div class="focus-desktop__tray"><span></span><span></span><span></span><span></span></div>
              </div>
            </motion.div>
          </div>
        </section>

        <motion.section
          id="privacy"
          class="course-privacy course-privacy--compact"
          aria-labelledby="privacy-title"
          :initial="revealInitial"
          :whileInView="revealTarget"
          :viewport="revealViewport"
          :transition="{ duration: 0.84, ease: easeOut }"
        >
          <div class="privacy-symbol" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <rect x="13" y="27" width="38" height="29" rx="10" />
              <path d="M21 27v-7c0-7 4.5-12 11-12s11 5 11 12v7" />
              <circle cx="32" cy="41" r="3" />
            </svg>
          </div>
          <p class="course-kicker">课表属于你</p>
          <h2 id="privacy-title">无需账号，不上传课表。</h2>
          <p>Excel 在本机解析，课程与设置保存在本机。课刻不建立云端课表。</p>
          <a :href="faqLink">了解数据位置与隐私</a>
        </motion.section>

        <motion.section
          class="course-closing course-closing--compact"
          aria-labelledby="closing-title"
          :initial="revealInitial"
          :whileInView="revealTarget"
          :viewport="revealViewport"
          :transition="{ duration: 0.86, ease: easeOut }"
        >
          <motion.img
            :src="markLink"
            alt=""
            width="72"
            height="72"
            :initial="{ opacity: 0, scale: 0.88 }"
            :whileInView="{ opacity: 1, scale: 1 }"
            :viewport="{ once: true, amount: 0.8 }"
            :transition="{ duration: 0.72, ease: easeOut }"
          />
          <h2 id="closing-title">把课表交给课刻。</h2>
          <p>面向 Windows 免费提供，下载后即可开始使用。</p>
          <div class="course-actions course-actions--center">
            <motion.a
              class="course-button course-button--primary"
              :href="releaseLink"
              :whileHover="{ scale: 1.015 }"
              :whilePress="{ scale: 0.985 }"
            >
              下载 Windows 版
            </motion.a>
            <a class="course-button course-button--text" :href="repositoryLink">在 GitHub 查看源码</a>
          </div>
        </motion.section>
      </main>

      <footer class="course-footer">
        <div>
          <a class="course-brand course-brand--footer" href="#top">
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
