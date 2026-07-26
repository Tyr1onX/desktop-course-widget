type Cleanup = () => void

export function setupStoryFocus(): Cleanup {
  const flow = document.querySelector<HTMLElement>('.day-flow')
  const indicator = flow?.querySelector<HTMLElement>('.day-flow__line span')
  const moments = flow ? Array.from(flow.querySelectorAll<HTMLElement>('.day-moment')) : []

  if (!flow || !indicator || moments.length < 2) return () => undefined

  let frame = 0
  let activeIndex = -1

  const updateFocus = () => {
    frame = 0

    const viewportCenter = window.innerHeight * 0.5
    const flowRect = flow.getBoundingClientRect()
    let nextIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY

    moments.forEach((moment, index) => {
      const rect = moment.getBoundingClientRect()
      const moduleCenter = rect.top + rect.height * 0.5
      const distance = Math.abs(moduleCenter - viewportCenter)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nextIndex = index
      }
    })

    const activeRect = moments[nextIndex].getBoundingClientRect()
    const focusY = activeRect.top - flowRect.top + 39.5

    indicator.style.top = `${focusY}px`
    indicator.style.transform = 'translateY(-50%)'

    if (nextIndex !== activeIndex) {
      activeIndex = nextIndex
      moments.forEach((moment, index) => {
        const active = index === activeIndex
        moment.classList.toggle('is-story-current', active)
        moment.classList.remove('is-story-passed')
        if (active) moment.setAttribute('aria-current', 'step')
        else moment.removeAttribute('aria-current')
      })
    }
  }

  const requestUpdate = () => {
    if (frame) return
    frame = window.requestAnimationFrame(updateFocus)
  }

  window.addEventListener('scroll', requestUpdate, { passive: true })
  window.addEventListener('resize', requestUpdate)
  updateFocus()

  return () => {
    if (frame) window.cancelAnimationFrame(frame)
    window.removeEventListener('scroll', requestUpdate)
    window.removeEventListener('resize', requestUpdate)
    indicator.removeAttribute('style')
    moments.forEach((moment) => {
      moment.classList.remove('is-story-current', 'is-story-passed')
      moment.removeAttribute('aria-current')
    })
  }
}
