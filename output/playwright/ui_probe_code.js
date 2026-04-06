async (page) => {
  const logs = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))

  const sampleState = async () => page.evaluate(() => {
    const root = document.querySelector('#app')?.__vue_app__?._instance
    const main = root?.subTree?.component?.subTree?.component
    const mapProxy = main?.setupState?.mapComponent
    const mapInternal = mapProxy?.['$']
    const assistantMessages = Array.from(document.querySelectorAll('.message.assistant'))
    const lastAssistant = assistantMessages.at(-1)
    const answerText = lastAssistant?.querySelector('.message-text')?.textContent?.trim() || ''
    const reasoningText = lastAssistant?.querySelector('.thinking-text')?.textContent?.trim() || ''
    const recognized = Array.from(lastAssistant?.querySelectorAll('.recognized-pill') || []).map((el) => el.textContent.trim())
    const renderButtons = Array.from(document.querySelectorAll('button')).map((el) => el.textContent.trim()).filter(Boolean)
    return {
      answerText,
      reasoningText,
      recognized,
      analysisBoardVisible: Boolean(document.querySelector('[aria-label="空间分析看板"]')),
      tagDataLen: Array.isArray(main?.setupState?.tagData) ? main.setupState.tagData.length : null,
      selectedFeaturesLen: Array.isArray(main?.setupState?.selectedFeatures) ? main.setupState.selectedFeatures.length : null,
      highlightDataLen: Array.isArray(mapInternal?.setupState?.highlightData) ? mapInternal.setupState.highlightData.length : null,
      heatmapDataLen: Array.isArray(mapInternal?.setupState?.heatmapData) ? mapInternal.setupState.heatmapData.length : null,
      renderButtonVisible: renderButtons.includes('渲染到地图')
    }
  })

  const clearBtn = page.getByRole('button', { name: '清空' })
  if (await clearBtn.count()) {
    await clearBtn.click()
  }

  await page.getByRole('button', { name: '武汉二中附近有哪些商超？' }).click()

  const timeline = []
  for (let i = 0; i < 80; i += 1) {
    await page.waitForTimeout(250)
    const state = await sampleState()
    timeline.push({ t: i * 250, answerLen: state.answerText.length, renderButtonVisible: state.renderButtonVisible })
    if (state.renderButtonVisible && state.answerText.length > 40) {
      const tail = timeline.slice(-4)
      if (tail.length === 4 && tail.every((item) => item.answerLen === tail[0].answerLen)) {
        break
      }
    }
  }

  const beforeRender = await sampleState()
  if (beforeRender.renderButtonVisible) {
    await page.getByRole('button', { name: '渲染到地图' }).click()
    await page.waitForTimeout(1200)
  }
  const afterRender = await sampleState()

  await page.screenshot({ path: 'output/playwright/wuhan-no2-supermarket-ui.png', fullPage: true })

  const notifications = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.el-notification')).map((el) => el.textContent.trim())
  )

  return {
    beforeRender,
    afterRender,
    timeline: timeline.filter((item, index, arr) => index === 0 || item.answerLen !== arr[index - 1].answerLen).slice(0, 12),
    notifications,
    logs: logs.filter((line) => /AiChat|App|MapContainer/.test(line)).slice(-20)
  }
}
