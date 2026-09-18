# Performance Rules

Portable static guidance for responsive systems. Measure runtime bottlenecks before optimizing.

### [SANE-PERF-01] Measure before optimizing

Establish a representative baseline using latency, throughput, memory, CPU, startup, render timing, transfer size, or battery metrics. Code shape alone is not evidence of a bottleneck.

### [SANE-PERF-02] Optimize the critical path first

Prioritize work that delays useful results, blocks interaction, increases tail latency, or consumes disproportionate resources. Defer non-critical work and remove blocking dependencies.

### [SANE-PERF-03] Bound work as input grows

Queries, loops, recursion, allocations, batches, and lists need reasonable growth behavior. Use pagination, streaming, batching, indexing, early termination, bounded buffers, and virtualization where appropriate.

### [SANE-PERF-04] Avoid accidental multiplicative work

Check nested queries, per-item network calls, repeated parsing/rendering, duplicate subscriptions, and unexpected algorithmic growth. Prefer bulk operations and suitable complexity.

### [SANE-PERF-05] Avoid repeated expensive work

Do not recompute, refetch, reparse, rerender, or reallocate unchanged results without reason. Caches and memoization must account for invalidation, permissions, locale, configuration, memory, and correctness.

### [SANE-PERF-06] Parallelize only independent work

Start independent I/O or computation together when resource limits, ordering, cancellation, and failure semantics allow it. Overwhelming a dependency is not an optimization.

### [SANE-PERF-07] Control data volume at the source

Select, filter, aggregate, compress, paginate, or stream only the fields, rows, records, and bytes the consumer needs.

### [SANE-PERF-08] Keep expensive work off latency-sensitive paths

Move heavy parsing, computation, serialization, media processing, and rendering away from startup, request handlers, event handlers, and interactive rendering when warranted by workload evidence.

### [SANE-PERF-09] Manage memory and resource lifetimes

Release listeners, timers, buffers, streams, connections, workers, and cached data when their owners no longer need them. Watch for unbounded caches, retained closures, and duplicate subscriptions.

### [SANE-PERF-10] Preserve responsiveness and fairness

Long work should yield, stream progress, or use an appropriate worker/background boundary. Include tail behavior and avoid starving other users, tasks, or event-loop work.

### [SANE-PERF-11] Re-measure and verify tradeoffs

Compare the result with the same baseline and workload. Confirm meaningful improvement without regressions in correctness, memory, reliability, security, or maintainability. Prefer the smallest optimization addressing the measured bottleneck.

## Review checklist

Identify the measured critical path, input-size and concurrency behavior, repeated or multiplicative work, resource lifetimes, and before/after evidence. Do not flag a static pattern as a defect without plausible impact or measurement where practical.