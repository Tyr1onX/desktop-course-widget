<script setup lang="ts">
import { withBase } from 'vitepress'

const guideLink = withBase('/guide/getting-started')
const faqLink = withBase('/help/faq')
const developmentLink = withBase('/development/')
const markLink = withBase('/app-icon.png')
const releaseLink = 'https://github.com/Tyr1onX/desktop-course-widget/releases/latest'
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'
</script>

<template>
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
          <p class="course-kicker">Windows 桌面课表</p>
          <h1 id="hero-title">一天的课程，<br />静静流过桌面。</h1>
          <p class="course-hero__lead">
            不再反复打开一张表。此刻正在发生什么、下一节是什么，抬眼就能看见。
          </p>
          <div class="course-actions">
            <a class="course-button course-button--primary" :href="releaseLink">
              免费下载
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5.25 3.5 9.75 8l-4.5 4.5" />
              </svg>
            </a>
            <a class="course-button course-button--text" :href="guideLink">了解如何使用</a>
          </div>
          <p class="course-hero__meta">适用于 Windows 10 与 Windows 11 · 本地优先</p>
        </div>

        <div class="course-stage" aria-label="桌面课表组件预览">
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
          </div>

          <div class="course-stage__dock" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>

        <p class="course-stage-caption">不是打开一张表，而是看见今天。</p>
      </section>

      <section id="experience" class="course-story" aria-labelledby="story-title">
        <div class="course-section-heading">
          <p class="course-kicker">时间，而不是格子</p>
          <h2 id="story-title">课表会跟着一天改变。</h2>
          <p>早晨告诉你今天，上课时留住此刻，结束后安静退场。信息只在需要的时候出现。</p>
        </div>

        <div class="day-flow">
          <div class="day-flow__line" aria-hidden="true">
            <span></span>
          </div>

          <article class="day-moment day-moment--morning">
            <div class="day-moment__time">08:10</div>
            <div class="day-moment__visual">
              <p>今天</p>
              <strong>3 节课</strong>
              <span>第一节 09:00 开始</span>
            </div>
            <div class="day-moment__copy">
              <span>早晨</span>
              <h3>先知道今天。</h3>
              <p>不用浏览整周，只留下今天真正需要记住的安排。</p>
            </div>
          </article>

          <article class="day-moment day-moment--current">
            <div class="day-moment__time">09:42</div>
            <div class="day-moment__visual day-moment__visual--current">
              <p>数字信号处理</p>
              <strong>正在上课</strong>
              <div class="moment-progress"><span></span></div>
              <span>还有 53 分钟</span>
            </div>
            <div class="day-moment__copy">
              <span>此刻</span>
              <h3>现在最清楚。</h3>
              <p>当前课程自然成为视觉中心，下一节保持恰到好处的距离。</p>
            </div>
          </article>

          <article class="day-moment day-moment--evening">
            <div class="day-moment__time">17:20</div>
            <div class="day-moment__visual day-moment__visual--quiet">
              <p>今天的课程已经结束</p>
              <strong>明天见。</strong>
              <span>星期二 · 2 节课</span>
            </div>
            <div class="day-moment__copy">
              <span>结束</span>
              <h3>不再打扰。</h3>
              <p>一天结束后，组件回到安静状态，把桌面还给你。</p>
            </div>
          </article>
        </div>
      </section>

      <section class="course-focus" aria-labelledby="focus-title">
        <div class="course-focus__inner">
          <div class="course-focus__copy">
            <p class="course-kicker course-kicker--light">桌面，本来就在那里</p>
            <h2 id="focus-title">无需多一步。</h2>
            <p>
              开机后自然出现，关闭时回到系统托盘。位置、缩放和多显示器状态都会被记住。
            </p>
            <a :href="guideLink">查看首次使用指南</a>
          </div>

          <div class="course-focus__visual" aria-hidden="true">
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
          </div>
        </div>
      </section>

      <section id="privacy" class="course-privacy" aria-labelledby="privacy-title">
        <div class="privacy-symbol" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <rect x="13" y="27" width="38" height="29" rx="10" />
            <path d="M21 27v-7c0-7 4.5-12 11-12s11 5 11 12v7" />
            <circle cx="32" cy="41" r="3" />
          </svg>
        </div>
        <p class="course-kicker">本地优先</p>
        <h2 id="privacy-title">你的课表，留在你的电脑里。</h2>
        <p>
          Excel 在本机解析，课程与设置保存在应用专属目录。无需账号，也没有云端课表数据库。
        </p>
        <a :href="faqLink">了解数据位置与隐私</a>
      </section>

      <section class="course-details" aria-label="功能详情">
        <div class="course-detail">
          <span>01</span>
          <h3>导入之后，仍可调整。</h3>
          <p>修改课程、周次、地点、教师、颜色和作息，不必重新制作 Excel。</p>
        </div>
        <div class="course-detail">
          <span>02</span>
          <h3>一台电脑，多张课表。</h3>
          <p>保存不同学期与不同版本，在设置中切换当前使用的课表。</p>
        </div>
        <div class="course-detail">
          <span>03</span>
          <h3>为真实桌面而生。</h3>
          <p>单实例、系统托盘、窗口位置恢复，并适配 DPI 与多显示器。</p>
        </div>
      </section>

      <section class="course-closing" aria-labelledby="closing-title">
        <img :src="markLink" alt="" width="72" height="72" />
        <h2 id="closing-title">让今天，回到桌面。</h2>
        <p>桌面课表目前面向 Windows，免费下载。</p>
        <div class="course-actions course-actions--center">
          <a class="course-button course-button--primary" :href="releaseLink">下载最新版</a>
          <a class="course-button course-button--text" :href="repositoryLink">在 GitHub 查看源码</a>
        </div>
      </section>
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
</template>
