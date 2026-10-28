(() => {
  // Not `buffered`: replaying earlier entries would count tasks from before the
  // measured interval, such as page load, as part of the interaction.
  window.__lt = [];
  window.__ltObs?.disconnect();
  window.__ltObs = new PerformanceObserver((list) => window.__lt.push(...list.getEntries()));
  window.__ltObs.observe({ type: 'longtask' });
  return 'longtask observer registered';
})()
