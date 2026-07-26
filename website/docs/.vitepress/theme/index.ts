import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'
import './motion.css'
import './layout-polish.css'
import './focus-polish.css'
import './demo-interactions.css'

export default {
  extends: DefaultTheme,
  Layout,
}
