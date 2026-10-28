(() => JSON.stringify({
  count: window.__lt.length,
  total_block_ms: Math.round(window.__lt.reduce((sum, e) => sum + e.duration, 0)),
  longest_ms: Math.round(Math.max(0, ...window.__lt.map((e) => e.duration))),
}))()
