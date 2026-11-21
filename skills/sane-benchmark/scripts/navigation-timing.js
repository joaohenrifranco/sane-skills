(() => JSON.stringify({
  navigation: performance.getEntriesByType('navigation')[0] || null,
  paint: performance.getEntriesByType('paint'),
}))()
