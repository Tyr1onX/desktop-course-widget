<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import HomePage from './HomePage.vue'
import ExperiencePage from './ExperiencePage.vue'
import { setupProjectFooter } from './project-footer'
import { setupStoryFocus } from './story-focus'
import { setupWebsiteDemo } from './website-demo'

const { frontmatter } = useData()
const DefaultLayout = DefaultTheme.Layout

let cleanupDemo: (() => void) | undefined

async function refreshDemo() {
  cleanupDemo?.()
  cleanupDemo = undefined

  await nextTick()
  const layout = frontmatter.value.layout
  if (layout === 'course-home' || layout === 'course-experience') {
    const cleanupWebsiteDemo = setupWebsiteDemo()
    const cleanupProjectFooter = layout === 'course-experience' ? setupProjectFooter() : () => undefined
    const cleanupStoryFocus = layout === 'course-experience' ? setupStoryFocus() : () => undefined
    cleanupDemo = () => {
      cleanupProjectFooter()
      cleanupStoryFocus()
      cleanupWebsiteDemo()
    }
  }
}

onMounted(refreshDemo)
watch(() => frontmatter.value.layout, refreshDemo)
onBeforeUnmount(() => cleanupDemo?.())
</script>

<template>
  <HomePage v-if="frontmatter.layout === 'course-home'" />
  <ExperiencePage v-else-if="frontmatter.layout === 'course-experience'" />
  <DefaultLayout v-else />
</template>
