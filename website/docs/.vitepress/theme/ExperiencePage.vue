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
            <a href="#import-edit">使用方式</a>
            <a href="#desktop-behavior">桌面行为</a>
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
            <h1 id="experience-title">课表会自己来到此刻。</h1>
            <p>上课、课间或一天结束，桌面上始终只留下现在需要知道的内容。</p>
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

          <p class="experience-hero__note">六种状态自动轮播，也可以暂停并手动切换。</p>
        </section>

        <motion.section
          id="import-edit"
          class="experience-import"
          aria-labelledby="import-title"
          :initial="{ opacity: 0, y: 34 }"
          :whileInView="{ opacity: 1, y: 0 }"
          :viewport="revealViewport"
          :transition="{ duration: 0.82, ease: easeOut }"
        >
          <div class="experience-import__heading">
            <p class="course-kicker">导入与编辑</p>
            <h2 id="import-title">导入一次，整个学期都在。</h2>
            <p>选择教务系统导出的 <code>.xlsx</code> 课表，先检查并修正，再按自己的习惯继续调整。</p>
            <a :href="guideLink">查看导入与编辑指南</a>
          </div>

          <div class="experience-import__steps">
            <article>
              <span>01</span>
              <h3>导入课表</h3>
              <p>直接读取教务系统导出的 Excel，不必重新录入整个学期。</p>
            </article>
            <article>
              <span>02</span>
              <h3>检查修正</h3>
              <p>导入后先核对课程安排，发现识别或格式差异时可以立即修正。</p>
            </article>
            <article>
              <span>03</span>
              <h3>继续编辑</h3>
              <p>课程名称、地点、周次、颜色与作息时间都可以按实际情况调整。</p>
            </article>
          </div>
        </motion.section>

        <section id="desktop-behavior" class="course-focus experience-focus" aria-labelledby="focus-title">
          <div class="course-focus__inner">
            <motion.div
              class="course-focus__copy"
              :initial="{ opacity: 0, y: 34 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.82, ease: easeOut }"
            >
              <p class="course-kicker course-kicker--light">桌面与系统托盘</p>
              <h2 id="focus-title">需要时看见，不需要时隐去。</h2>
              <p>点击组件的关闭按钮，课刻会回到系统托盘；点击托盘图标，它就重新出现在桌面。</p>
              <ul class="experience-focus__facts">
                <li>记住组件的位置、缩放与显示习惯</li>
                <li>可随 Windows 启动，打开电脑即可看见</li>
              </ul>
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
          class="course-privacy course-privacy--compact experience-privacy"
          aria-labelledby="privacy-title"
          :initial="{ opacity: 0, y: 34 }"
          :whileInView="{ opacity: 1, y: 0 }"
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
          <p class="course-kicker">本地与隐私</p>
          <h2 id="privacy-title">无需账号，不上传课表。</h2>
          <p>Excel 在本机解析，课程与设置保存在本机。课刻不建立云端课表。</p>
          <a :href="faqLink">了解数据位置与隐私</a>
        </motion.section>

        <motion.section
          class="course-closing experience-closing"
          aria-labelledby="experience-closing-title"
          :initial="{ opacity: 0, y: 34 }"
          :whileInView="{ opacity: 1, y: 0 }"
          :viewport="revealViewport"
          :transition="{ duration: 0.84, ease: easeOut }"
        >
          <img :src="markLink" alt="" width="64" height="64" />
          <h2 id="experience-closing-title">把课表放回桌面。</h2>
          <p>导入课表后，课刻会根据真实时间自动留下此刻需要知道的安排。</p>
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
