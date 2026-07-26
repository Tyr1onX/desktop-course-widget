<script setup lang="ts">
import { MotionConfig, motion } from 'motion-v'
import { withBase } from 'vitepress'

const guideLink = withBase('/guide/getting-started')
const managementLink = withBase('/guide/schedule-management')
const experienceLink = withBase('/experience/')
const faqLink = withBase('/help/faq')
const developmentLink = withBase('/development/')
const markLink = withBase('/app-icon-v2.svg')
const releaseLink = 'https://github.com/Tyr1onX/desktop-course-widget/releases/latest'
const repositoryLink = 'https://github.com/Tyr1onX/desktop-course-widget'

const easeOut = [0.22, 1, 0.36, 1]
const revealViewport = { once: true, amount: 0.24 }
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div class="course-home course-home--three-part">
      <header class="course-nav" aria-label="主导航">
        <div class="course-nav__inner">
          <a class="course-brand" href="#top" aria-label="课刻首页">
            <img :src="markLink" alt="" width="28" height="28" />
            <span>课刻</span>
          </a>

          <nav class="course-nav__links" aria-label="页面导航">
            <a href="#product">产品</a>
            <a :href="experienceLink">完整体验</a>
            <a :href="guideLink">使用指南</a>
          </nav>

          <a class="course-nav__download" :href="releaseLink">下载 Windows 版</a>
        </div>
      </header>

      <main id="top">
        <section class="course-hero course-hero--split" aria-labelledby="hero-title">
          <div class="course-hero__inner">
            <div class="course-hero__copy">
              <motion.p
                class="course-kicker"
                :initial="{ opacity: 0, y: 14 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.62, delay: 0.04, ease: easeOut }"
              >
                课刻 · Windows 桌面课表
              </motion.p>

              <motion.h1
                id="hero-title"
                :initial="{ opacity: 0, y: 30 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.84, delay: 0.12, ease: easeOut }"
              >
                让一天的课程，<br />静静流过桌面。
              </motion.h1>

              <motion.p
                class="course-hero__lead"
                :initial="{ opacity: 0, y: 22 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.72, delay: 0.27, ease: easeOut }"
              >
                课刻把正在上的课、下一节和今天剩下的安排，放在抬眼就能看见的位置。
              </motion.p>

              <motion.div
                class="course-actions"
                :initial="{ opacity: 0, y: 18 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="{ duration: 0.66, delay: 0.39, ease: easeOut }"
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
                <a class="course-button course-button--text" :href="experienceLink">查看产品体验</a>
              </motion.div>

              <motion.p
                class="course-hero__meta"
                :initial="{ opacity: 0 }"
                :animate="{ opacity: 1 }"
                :transition="{ duration: 0.58, delay: 0.52 }"
              >
                Windows 10 / 11 · 免费 · 本地优先
              </motion.p>
            </div>

            <motion.div
              class="hero-mark"
              aria-label="课刻应用图标"
              :initial="{ opacity: 0, x: 48, scale: 0.92 }"
              :animate="{ opacity: 1, x: 0, scale: 1 }"
              :transition="{ duration: 1.05, delay: 0.2, ease: easeOut }"
            >
              <div class="hero-mark__glow" aria-hidden="true"></div>
              <div class="hero-mark__orbit hero-mark__orbit--outer" aria-hidden="true"></div>
              <div class="hero-mark__orbit hero-mark__orbit--inner" aria-hidden="true"></div>
              <div class="hero-mark__time hero-mark__time--morning" aria-hidden="true">08:00</div>
              <div class="hero-mark__time hero-mark__time--afternoon" aria-hidden="true">15:30</div>
              <motion.img
                :src="markLink"
                alt="课刻"
                width="340"
                height="340"
                :animate="{ y: [0, -9, 0], rotate: [0, 0.7, 0] }"
                :transition="{ duration: 7.5, repeat: Infinity, ease: 'easeInOut' }"
              />
              <p>一天，在桌面上缓慢流动。</p>
            </motion.div>
          </div>
        </section>

        <section id="product" class="product-showcase" aria-labelledby="product-title">
          <motion.div
            class="product-showcase__heading"
            :initial="{ opacity: 0, y: 34 }"
            :whileInView="{ opacity: 1, y: 0 }"
            :viewport="revealViewport"
            :transition="{ duration: 0.82, ease: easeOut }"
          >
            <p class="course-kicker">看见当下，也整理全局</p>
            <h2 id="product-title">桌面负责提醒，设置负责安排。</h2>
            <p>正在发生的课程留在桌面；整个学期的课程、时间与周次，回到设置窗口中清楚整理。</p>
          </motion.div>

          <div class="product-showcase__grid">
            <motion.article
              class="product-panel product-panel--widget"
              :initial="{ opacity: 0, y: 42 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.9, ease: easeOut }"
            >
              <header class="product-panel__copy">
                <span>桌面组件</span>
                <h3>此刻需要知道的，刚好都在这里。</h3>
                <p>课程状态、剩余时间、进度和后续安排会随真实时间自动变化。</p>
              </header>

              <div class="course-stage course-stage--product" aria-label="课刻桌面组件真实状态演示">
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
              </div>

              <footer class="product-panel__footer">
                <span>真实组件逻辑</span>
                <a :href="experienceLink">查看全部状态</a>
              </footer>
            </motion.article>

            <motion.article
              class="product-panel product-panel--settings"
              :initial="{ opacity: 0, y: 42 }"
              :whileInView="{ opacity: 1, y: 0 }"
              :viewport="revealViewport"
              :transition="{ duration: 0.9, delay: 0.08, ease: easeOut }"
            >
              <header class="product-panel__copy">
                <span>课表编辑</span>
                <h3>整个学期，仍然由你决定。</h3>
                <p>直接修改课程名称、颜色、时间、周次、地点和教师。</p>
              </header>

              <div class="settings-preview settings-preview--product" aria-label="课刻设置窗口中的周课表与编辑课程界面预览">
                <div class="settings-preview__titlebar" aria-hidden="true">
                  <span>课表与设置</span>
                  <div><i></i><i></i><i></i></div>
                </div>

                <div class="settings-preview__app">
                  <header class="settings-preview__toolbar">
                    <div class="settings-preview__selector">
                      <strong>2026 秋季学期</strong>
                      <span aria-hidden="true">⌄</span>
                    </div>
                    <div class="settings-preview__week">
                      <button type="button" tabindex="-1" aria-hidden="true">‹</button>
                      <strong>第 3 教学周</strong>
                      <button type="button" tabindex="-1" aria-hidden="true">›</button>
                    </div>
                    <div class="settings-preview__toolbar-actions" aria-hidden="true">
                      <span>＋</span><span>⋯</span>
                    </div>
                  </header>

                  <div class="settings-preview__stage">
                    <div class="settings-preview__calendar" aria-hidden="true">
                      <div class="settings-preview__calendar-head">
                        <div class="settings-preview__month"><strong>9</strong><span>月</span></div>
                        <div><span>一</span><strong>21</strong></div>
                        <div class="is-today"><span>二</span><strong>22</strong></div>
                        <div><span>三</span><strong>23</strong></div>
                        <div><span>四</span><strong>24</strong></div>
                        <div><span>五</span><strong>25</strong></div>
                        <div><span>六</span><strong>26</strong></div>
                        <div><span>日</span><strong>27</strong></div>
                      </div>

                      <div class="settings-preview__calendar-body">
                        <div class="settings-preview__times">
                          <div><strong>1</strong><span>08:00</span></div>
                          <div><strong>2</strong><span>08:55</span></div>
                          <div><strong>3</strong><span>10:00</span></div>
                          <div><strong>4</strong><span>10:55</span></div>
                          <div><strong>5</strong><span>13:30</span></div>
                          <div><strong>6</strong><span>14:25</span></div>
                        </div>
                        <div class="settings-preview__grid"></div>
                        <div class="settings-preview__course is-blue" style="--day:1;--row:1;--span:2">
                          <strong>通信原理</strong><span>逸夫楼 B311</span>
                        </div>
                        <div class="settings-preview__course is-green" style="--day:2;--row:3;--span:2">
                          <strong>数字信号处理</strong><span>李四光楼 201</span>
                        </div>
                        <div class="settings-preview__course is-purple is-selected" style="--day:3;--row:1;--span:2">
                          <strong>单片机原理及应用</strong><span>实验楼 B203</span>
                        </div>
                        <div class="settings-preview__course is-orange" style="--day:4;--row:5;--span:2">
                          <strong>信息论</strong><span>经信 F101</span>
                        </div>
                        <div class="settings-preview__course is-pink" style="--day:5;--row:3;--span:2">
                          <strong>高频电子技术</strong><span>逸夫楼 B205</span>
                        </div>
                      </div>
                    </div>

                    <div class="settings-preview__dimmer" aria-hidden="true"></div>

                    <aside class="settings-preview__surface" aria-label="编辑课程">
                      <header><h3>编辑课程</h3><span aria-hidden="true">×</span></header>
                      <div class="settings-preview__form">
                        <label class="settings-preview__field settings-preview__field--full">
                          <span>课程名称</span>
                          <b>单片机原理及应用</b>
                        </label>

                        <div class="settings-preview__colors">
                          <span>课程颜色</span>
                          <div aria-hidden="true">
                            <i style="--swatch:#cfe1ff"></i><i style="--swatch:#d8ebcf"></i><i style="--swatch:#f8d8d2"></i><i class="is-active" style="--swatch:#e5d9f7"></i><i style="--swatch:#f9e3b7"></i>
                          </div>
                        </div>

                        <div class="settings-preview__section-heading">
                          <strong>上课时间</strong>
                          <span>一门课程可以添加多个时间段。</span>
                        </div>

                        <div class="settings-preview__slot">
                          <strong>时间段 1</strong>
                          <div class="settings-preview__form-grid">
                            <label class="settings-preview__field"><span>星期</span><b>周三</b></label>
                            <label class="settings-preview__field"><span>节次</span><b>1 至 2</b></label>
                            <label class="settings-preview__field"><span>起始周</span><b>1</b></label>
                            <label class="settings-preview__field"><span>结束周</span><b>16</b></label>
                            <label class="settings-preview__field settings-preview__field--full"><span>重复</span><b>每周</b></label>
                            <label class="settings-preview__field settings-preview__field--full"><span>地点</span><b>实验楼 B203</b></label>
                            <label class="settings-preview__field settings-preview__field--full"><span>老师</span><b>示例教师</b></label>
                          </div>
                        </div>
                      </div>
                      <footer>
                        <button type="button" tabindex="-1">删除课程</button>
                        <div><span>取消</span><strong>保存修改</strong></div>
                      </footer>
                    </aside>
                  </div>
                </div>
              </div>

              <footer class="product-panel__footer">
                <span>当前设置窗口</span>
                <a :href="managementLink">查看管理指南</a>
              </footer>
            </motion.article>
          </div>
        </section>
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
