import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'
import './motion.css'
import './focus-polish.css'
import './demo-interactions.css'
import './real-widget-demo.css'
import '../../../../src/time-flow.css'
import '../../../../src/course-handoff.css'
import './project-footer.css'
import './experience-page.css'
import './three-part-homepage.css'
import './orbit-homepage-fixes.css'
import './orbit-accuracy-fixes.css'
import './responsive-audit.css'
import './time-motion.css'
import './mobile-home.css'
import './mobile-footer-motion.css'

export default {
  extends: DefaultTheme,
  Layout,
}
