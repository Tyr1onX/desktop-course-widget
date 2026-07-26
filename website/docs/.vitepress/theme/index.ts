import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'
import './motion.css'
import './layout-polish.css'
import './focus-polish.css'
import './demo-interactions.css'
import './real-widget-demo.css'
import '../../../../src/time-flow.css'
import './story-focus.css'
import './project-footer.css'
import './experience-page.css'
import './settings-showcase.css'
import './settings-showcase-positioning.css'

export default {
  extends: DefaultTheme,
  Layout,
}
