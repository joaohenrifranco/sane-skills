(() => {
  const entries = performance.getEntriesByType('resource');
  const resources = entries
    .map((r) => ({
      name: r.name.split('/').pop().split('?')[0],
      url: r.name,
      type: r.initiatorType,
      size: r.transferSize,
      duration: Math.round(r.duration),
      start: Math.round(r.startTime),
    }))
    .sort((a, b) => b.duration - a.duration);
  const byType = entries.reduce((acc, e) => {
    const t = e.initiatorType;
    acc[t] = acc[t] || { count: 0, bytes: 0 };
    acc[t].count++;
    acc[t].bytes += e.transferSize || 0;
    return acc;
  }, {});
  return JSON.stringify({
    total_requests: entries.length,
    total_bytes: entries.reduce((sum, e) => sum + (e.transferSize || 0), 0),
    by_type: byType,
    resources,
  });
})()
