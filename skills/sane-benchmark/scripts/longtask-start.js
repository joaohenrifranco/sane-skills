(() => {
  window.__lt = [];
  window.__ltObs?.disconnect();
  window.__ltObs = new PerformanceObserver((list) => window.__lt.push(...list.getEntries()));
  window.__ltObs.observe({ type: 'longtask', buffered: true });
  return 'longtask observer registered';
})()
