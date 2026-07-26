<script setup lang="ts">
import { MotionConfig, motion } from 'motion-v'
import { withBase } from 'vitepress'

const guideLink = withBase('/guide/getting-started')
const faqLink = withBase('/help/faq')
const developmentLink = withBase('/development/')
const markLink = withBase('/app-icon.png')
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
          <a class="course-brand" href="#top" aria-label="桌面课表首页">
            <img :src="markLink" alt="" width="28" height="28" />
            <span>桌面课表</span>
          </a>

          <nav class="course-nav__links" aria-label="页面导航">
            <a href="#experience">体验</a>
            <a href="#privacy">隐私</a>
            <a :href="guideLink">使用指南</a>
          </nav>

          <a class="course-nav__download" :href="releaseLink">下载</a>
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
              Windows 桌面课表
            </motion.p>
            <motion.h1
              id="hero-title"
              :initial="{ opacity: 0, y: 28 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ duration: 0.82, delay: 0.13, ease: easeOut }"
            >
              一天的课程，<br />静静流过桌面。
            </motion.h1>
            <motion.p
              class="course-hero__lead"
              :initial="{ opacity: 0, y: 22 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ duration: 0.72, delay: 0.28, ease: easeOut }"
            >
              现在上什么，下一节几点。抬眼就知道。
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
                免费下载
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.25 3.5 9.75 8l-4.5 4.5" />
                </svg>
              </motion.a>
              <a class="course-button course-button--text" :href="guideLink">了解如何使用</a>
            </motion.div>
            <motion.p
              class="course-hero__meta"
              :initial="{ opacity: 0 }"
              :animate="{ opacity: 1 }"
              :transition="{ duration: 0.6, delay: 0.52 }"
            >
              Windows 10 / 11 · 课表只保存在本机
            </motion.p>
          </div>

          <motion.div
            class="course-stage"
            aria-label="桌面课表组件预览"
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
                <div>
                  <p>星期一</p>
                  <strong>7月27日</strong>
                </div>
                <span>第 5 周</span>
              </div>

              <div class="widget-now">
                <span class="widget-now__dot"></span>
                <span>现在 · 09:42</span>
              </div>

              <div class="widget-course widget-course--active">
                <div class="widget-course__time">
                  <strong>09:00</strong>
                  <span>10:35</span>
                </div>
                <div class="widget-course__line" aria-hidden="true">
                  <span></span>
                </div>
                <div class="widget-course__content">
                  <span>正在上课</span>
                  <strong>数字信号处理</strong>
                  <p>逸夫教学楼 · B311</p>
                </div>
              </div>

              <div class="widget-course">
                <div class="widget-course__time">
                  <strong>10:50</strong>
                  <span>12:25</span>
                </div>
                <div class="widget-course__line" aria-hidden="true"></div>
                <div class="widget-course__content">
                  <span>接下来</span>
                  <strong>通信原理</strong>
                  <p>李四光楼 · 201</p>
                </div>
              </div>

              <div class="widget-window__footer">
                <span>今天还有 2 节课</span>
                <span>打开完整课表</span>
              </div>
            </motion.div>

            <div class="course-stage__dock" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </motion.div>

          <motion.p
            class="course-stage-caption"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :transition="{ duration: 0.7, delay: 1.05 }"
          >
            不是多打开一个页面，而是少记住一件事。
          </motion.p>
        </section>

        <section id="experience" class="course-story" aria-labelledby="story-title">
          <motion.div
            class="course-section-heading"
            :initial="revealInitial"
            :whileInView="revealTarget"
            :viewport="revealViewport"
            :transition="{ duration: 0.82, ease: easeOut }"
          >
            <p class="course-kicker">时间，而不是格子</p>
            <h2 id="story-title">它知道，现在该显示什么。</h2>
            <p>早晨看见今天，上课时聚焦此刻。最后一节结束，界面也随之安静。</p>
          </motion.div>

          <div class="day-flow">
            <div class="day-flow__line" aria-hidden="true">
              <span></span>
            </div>

            <motion.article
              class="day-moment day-moment--morning"
              :initial="{ opacity: 0, y: 46 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.78, ease: easeOut }"
            >
              <div class="day-moment__time">08:10</div>
              <div class="day-moment__visual">
                <p>今天</p>
                <strong>3 节课</strong>
                <span>第一节 09:00 开始</span>
              </div>
              <div class="day-moment__copy">
                <span>早晨</span>
                <h3>今天，从第一节开始。</h3>
                <p>打开电脑，今天的安排已经在那里。无需浏览整周。</p>
              </div>
            </motion.article>

            <motion.article
              class="day-moment day-moment--current"
              :initial="{ opacity: 0, y: 46, scale: 0.985 }"
              :whileInView="{ opacity: 1, y: 0, scale: 1 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.82, ease: easeOut }"
            >
              <div class="day-moment__time">09:42</div>
              <div class="day-moment__visual day-moment__visual--current">
                <p>数字信号处理</p>
                <strong>正在上课</strong>
                <div class="moment-progress">
                  <motion.span
                    :initial="{ scaleX: 0 }"
                    :whileInView="{ scaleX: 1 }"
                    :viewport="{ once: true, amount: 0.8 }"
                    :transition="{ duration: 1.1, delay: 0.18, ease: easeOut }"
                  ></motion.span>
                </div>
                <span>还有 53 分钟</span>
              </div>
              <div class="day-moment__copy">
                <span>此刻</span>
                <h3>此刻，只看这一节。</h3>
                <p>正在发生的课程成为视觉中心。下一节，只留在刚好能看见的位置。</p>
              </div>
            </motion.article>

            <motion.article
              class="day-moment day-moment--evening"
              :initial="{ opacity: 0, y: 46 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.78, ease: easeOut }"
            >
              <div class="day-moment__time">17:20</div>
              <div class="day-moment__visual day-moment__visual--quiet">
                <p>今天的课程已经结束</p>
                <strong>明天见。</strong>
                <span>星期二 · 2 节课</span>
              </div>
              <div class="day-moment__copy">
                <span>结束</span>
                <h3>课程结束，桌面归于安静。</h3>
                <p>没有课的时候，它不争夺注意力。明天的安排，等明天再出现。</p>
              </div>
            </motion.article>
          </div>
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
              <p class="course-kicker course-kicker--light">桌面，本来就在那里</p>
              <h2 id="focus-title">它一直都在。</h2>
              <p>开机后自然出现，需要时查看，关闭后回到系统托盘。位置与缩放会被记住。</p>
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
                  <div>
                    <span>下一节</span>
                    <strong>通信原理</strong>
                  </div>
                  <p>10:50 · 李四光楼 201</p>
                </div>
                <div class="focus-desktop__cursor"></div>
                <div class="focus-desktop__tray">
                  <span></span><span></span><span></span><span></span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <motion.section
          id="privacy"
          class="course-privacy"
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
          <p class="course-kicker">本地优先</p>
          <h2 id="privacy-title">你的课表，留在你的电脑里。</h2>
          <p>Excel 在本机解析，课程与设置只保存在应用目录。无需账号，也没有云端课表数据库。</p>
          <a :href="faqLink">了解数据位置与隐私</a>
        </motion.section>

        <section class="course-details" aria-label="功能详情">
          <motion.div
            class="course-detail"
            :initial="{ opacity: 0, y: 32 }"
            :whileInView="{ opacity: 1, y: 0 }"
            :viewport="revealViewport"
            :transition="{ duration: 0.7, ease: easeOut }"
          >
            <span>01</span>
            <h3>导入，不等于定稿。</h3>
            <p>课程、周次、地点、教师、颜色和作息，都可以继续调整。</p>
          </motion.div>
          <motion.div
            class="course-detail"
            :initial="{ opacity: 0, y: 32 }"
            :whileInView="{ opacity: 1, y: 0 }"
            :viewport="revealViewport"
            :transition="{ duration: 0.7, delay: 0.08, ease: easeOut }"
          >
            <span>02</span>
            <h3>每个学期，各自安放。</h3>
            <p>保存不同学期与不同版本，切换时不必覆盖原来的安排。</p>
          </motion.div>
          <motion.div
            class="course-detail"
            :initial="{ opacity: 0, y: 32 }"
            :whileInView="{ opacity: 1, y: 0 }"
            :viewport="revealViewport"
            :transition="{ duration: 0.7, delay: 0.16, ease: easeOut }"
          >
            <span>03</span>
            <h3>像桌面的一部分。</h3>
            <p>单实例、系统托盘、位置恢复，并适配 DPI 与多显示器。</p>
          </motion.div>
        </section>

        <motion.section
          class="course-closing"
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
          <h2 id="closing-title">让今天，回到桌面。</h2>
          <p>桌面课表目前面向 Windows，免费下载。</p>
          <div class="course-actions course-actions--center">
            <motion.a
              class="course-button course-button--primary"
              :href="releaseLink"
              :whileHover="{ scale: 1.015 }"
              :whilePress="{ scale: 0.985 }"
            >
              下载最新版
            </motion.a>
            <a class="course-button course-button--text" :href="repositoryLink">在 GitHub 查看源码</a>
          </div>
        </motion.section>
      </main>

      <footer class="course-footer">
        <div>
          <a class="course-brand course-brand--footer" href="#top">
            <img :src="markLink" alt="" width="24" height="24" />
            <span>桌面课表</span>
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
