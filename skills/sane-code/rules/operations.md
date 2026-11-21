# Operations Rules

Opinionated defaults for changes that must be observable in production, evolvable without breaking consumers, and safe to release.

### [SANE-OPS-NO-SILENT-FAILURE] Make failures that need action observable

A failure that a person or system must act on is recorded at the boundary that decides its outcome: reported once, with enough context to act, and either surfaced to the caller or raised as an alertable signal. An empty catch, a swallowed rejection, and a fallback that hides the error are defects. Do not log and rethrow at every layer; duplicated reports bury the one that matters (`SANE-CORRECT-EXPLICIT-UNCERTAINTY`).

### [SANE-OPS-CORRELATED-SIGNALS] Correlate signals for one unit of work

Logs, metrics, and error reports for one request, job, or message carry a stable identifier that links them across boundaries, plus its outcome and duration where relevant, and omit sensitive data (`SANE-SEC-DATA-MINIMIZATION`). For each change that matters in production, name the signal that would show it failing and where to read it. A change nobody can observe failing is not finished.

### [SANE-OPS-EXPAND-CONTRACT] Evolve contracts and stored data in compatible steps

Assume every released contract and persisted shape has consumers that cannot be updated atomically: older clients, in-flight jobs, previously written data, other services. Add the new form first, move consumers and data over, and remove the old form only after evidence shows that no consumer remains. Measure active consumers instead of assuming a version floor.

### [SANE-OPS-REVERSIBLE-ROLLOUT] Give risky changes a way back

A change with irreversible, user-visible, or cross-component effects needs a rollback, a feature flag or kill switch, or staged exposure. State the deploy order when components depend on each other, and do not couple an irreversible step to a deploy that cannot be undone. Make backfills and data migrations bounded, resumable, and safe to run twice (`SANE-CORRECT-DURABLE-PROGRESS`).
