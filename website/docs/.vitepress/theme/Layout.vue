<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import HomePage from './HomePage.vue'
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
  if (frontmatter.value.layout === 'course-home') {
    const cleanupWebsiteDemo = setupWebsiteDemo()
    const cleanupStoryFocus = setupStoryFocus()
    const cleanupProjectFooter = setupProjectFooter()
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
  <DefaultLayout v-else />
</template>
