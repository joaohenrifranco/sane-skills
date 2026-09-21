# Performance Rules

Opinionated defaults for measured latency, bounded resource use, and fair behavior under representative load.

### [SANE-PERF-MEASURE-FIRST] Require evidence before optimization

Establish a representative workload and baseline for the affected user or system outcome before adding performance complexity. Profiles and measurements outrank intuition; code shape alone does not prove a bottleneck. Fix demonstrably unbounded work or an obvious multiplicative remote call without production profiling, but still add a reproducible measurement when claiming improvement.

### [SANE-PERF-USEFUL-OUTCOME] Optimize the path to the useful outcome

Define the useful outcome and improve the work that determines its latency, throughput, or resource budget. Remove or defer nonessential work from that path before micro-optimizing code outside it. Do not trade correctness or move work elsewhere merely to improve an isolated local metric.

### [SANE-PERF-BOUNDED-WORK] Put a finite bound on input-dependent work

Any request, render, job, or message driven by variable input must have a finite bound on records examined, bytes retained, recursion depth, queued work, and output produced. Apply the bound at the producer rather than materializing an unbounded input and trimming afterward. A trusted offline job may exceed interactive limits, but it still needs an explicit resource budget and resumable progress when the dataset can grow.

### [SANE-PERF-SET-ORIENTED-WORK] Eliminate multiplicative remote and per-item work

Do not issue a query, network call, parse, render, or full scan once per item when one set-oriented operation can serve the collection. Make operation count visible and keep it constant or intentionally bounded as collection size grows. A direct per-item approach is acceptable only for a small enforced maximum where batching would add more cost than it removes.

### [SANE-PERF-CACHE-AFTER-DEDUPLICATION] Remove duplication before adding a cache

Within one operation, compute or fetch an unchanged value once and reuse it. Add a cross-operation cache only after measurement shows repeated work matters and one owner defines keys, invalidation, permission scope, and a memory bound. Do not use memoization to conceal an inefficient dependency path; a stale or unbounded cache is a correctness and capacity defect, not an optimization.

### [SANE-PERF-BOUNDED-CONCURRENCY] Bound concurrency around the constrained resource

Run independent work concurrently only up to an explicit limit chosen for the constrained dependency, CPU, memory, or connection pool. Unbounded fan-out and one-task-per-item defaults are prohibited because they convert load into queueing and failure. Preserve ordering only when the contract requires it; otherwise avoid serializing independent work without evidence.

### [SANE-PERF-SOURCE-REDUCTION] Reduce data at its source

Fetch, decode, and transfer only the fields and records the consumer will use, with filtering and limits applied by the data owner. Do not retrieve a full object graph or dataset and discard most of it locally. Accept over-fetching only for a small stable representation when projection would add measurable overhead or violate the source contract.

### [SANE-PERF-LATENCY-BUDGETS] Keep latency-sensitive paths within a work budget

Synchronous startup, request, event, and render paths may perform only work with a known bounded cost appropriate to their latency budget. Move heavy work behind an explicit asynchronous outcome when the contract permits delayed completion; do not merely hide it in an unobserved task. Small deterministic work should remain direct rather than paying coordination overhead for speculative offloading.

### [SANE-PERF-RESOURCE-CAPACITY] Give every retained resource a capacity and owner

The component that creates a connection, listener, timer, worker, buffer, queue, or cache owns its release and must define a finite capacity for retained resources. Do not rely on process lifetime, garbage collection timing, or traffic eventually subsiding. Pools and queues must apply backpressure or rejection at capacity rather than grow until the process or dependency fails.

### [SANE-PERF-TAIL-FAIRNESS] Optimize tail behavior and fairness

Measure high-percentile behavior under concurrent load, not only averages in isolation. No request, tenant, batch, or CPU task may monopolize a shared worker, event loop, connection pool, or queue; divide or schedule long work so bounded progress remains available to others. A throughput gain that causes starvation or unacceptable tail latency is a regression.

### [SANE-PERF-PROVEN-OPTIMIZATIONS] Keep only optimizations that prove their tradeoff

Re-run the same representative workload after the change and compare the original user-facing metric plus memory and resource consumption. Retain the smallest change that delivers a material improvement without degrading correctness, reliability, security, or maintainability. Remove speculative complexity when the gain is within noise, and add a stable regression benchmark when the optimized budget is important enough to defend.
