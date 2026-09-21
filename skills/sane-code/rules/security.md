# Security Rules

Opinionated defaults for enforcing trust, confidentiality, integrity, and availability at the boundary that owns each protected operation.

### [SANE-SEC-UNTRUSTED-INPUT] Reject untrusted input at the first trusted boundary

Treat every value originating outside the current trust boundary as hostile until it has been parsed into a bounded, validated representation. Reject invalid type, encoding, size, range, and unsupported structure before expensive work or side effects. Client-side checks and upstream validation are usability aids, not security controls; validation may be relaxed only for data produced and integrity-protected by the same trust domain.

### [SANE-SEC-RESOURCE-AUTHORIZATION] Authorize the specific operation and resource

Authenticate identity, then deny by default unless that identity may perform this action on this resource in its current tenant and state. Enforce the decision at the trusted operation boundary on every request, not only in UI visibility, routing, or an upstream gateway. Cache authorization only when revocation and policy-version behavior are explicit and the accepted stale-permission window is documented.

### [SANE-SEC-LEAST-PRIVILEGE] Use dedicated least-privilege identities

Give each user, workload, job, and delivery stage only the capabilities it needs, scoped to the smallest resources and duration practical. Do not reuse administrator credentials for ordinary runtime or share one broad identity across independently deployable workloads. Exceptional elevation must be explicit, time-bounded, and auditable because operational convenience is not a reason for permanent privilege.

### [SANE-SEC-RUNTIME-SECRETS] Deliver secrets only at runtime

Credentials, signing keys, tokens, and sensitive connection material must enter through the deployment environment's designated secret channel and remain absent from source, fixtures, client artifacts, URLs, logs, errors, and build output. Do not disguise secrets with encoding or committed encryption whose key travels with the repository. Rotate suspected exposure immediately and design consumers to accept rotation without a code change.

### [SANE-SEC-DATA-NOT-SYNTAX] Keep data out of executable syntax

Pass variable data through typed or parameterized APIs so interpreters never parse it as SQL, shell, template, path, query, regular-expression, or generated-code syntax. Do not rely on manual escaping or string concatenation. When syntax itself must vary, select it from a closed trusted allowlist; untrusted values must never choose arbitrary identifiers, operators, paths, or code.

### [SANE-SEC-CALLBACK-AUTHENTICITY] Authenticate callbacks before interpreting them

Verify callback, webhook, message, and uploaded artifact authenticity, integrity, intended audience, freshness, and replay policy before parsing deeply or causing any effect. Bind verification to the exact received bytes when the protocol signs bytes, and reject missing or ambiguous credentials. An unsigned source may provide untrusted input, but it must not authoritatively trigger a protected transition.

### [SANE-SEC-OUTPUT-ENCODING] Encode at the final output sink

Use the destination's safe output API and apply context-specific encoding at the last boundary before untrusted data reaches an interpreter. Do not pre-escape reusable values, bypass automatic encoding, or insert raw markup or script. If user-authored rich content is a product requirement, sanitize it with a restrictive policy and keep it out of executable contexts; trusted provenance alone is not a sanitizer.

### [SANE-SEC-DATA-MINIMIZATION] Minimize sensitive data by default

Do not collect, copy, return, or retain sensitive fields unless the owning feature requires them. Logging and telemetry must use an allowlist of safe fields rather than redact known secrets after capture, and tests must use synthetic data. Stored sensitive data needs an explicit retention and deletion policy; indefinite retention is not an acceptable default.

### [SANE-SEC-RESOURCE-LIMITS] Bound attacker-controlled resource use

Every externally triggerable operation must impose hard limits before allocating, querying, decompressing, retrying, or fanning out work. Reject oversized or over-quota requests before expensive processing, and cap result size and concurrent work at the owning boundary. Do not depend on downstream exhaustion or infrastructure timeouts as the primary abuse control; trusted batch paths may use higher, still finite limits.

### [SANE-SEC-SAFE-SECURITY-LOGGING] Record security events without recording payloads

Emit structured security events with stable event types, outcomes, and only the identifiers needed for investigation. Do not expose stack traces, topology, policy details, credentials, sensitive identifiers, or raw attacker-controlled content to users or routine logs. Audit records for privileged actions must be access-controlled and attributable; debugging convenience does not justify secret leakage.

### [SANE-SEC-SUPPLY-CHAIN] Pin and constrain the delivery supply chain

Commit resolved dependency locks, review new packages and lifecycle scripts, and pin third-party CI actions and build inputs to immutable versions. CI jobs must start with minimal permissions, and untrusted changes must not receive deployment credentials or execute in a trusted release context. Reject a dependency when a small local implementation avoids unjustified install-time authority or transitive risk.

### [SANE-SEC-FAIL-CLOSED] Fail closed across security-sensitive failures

If identity, permission, signature, key material, policy, or security configuration cannot be established, deny the protected operation and preserve the previously secure state. Retries, rolling deployments, stale caches, and dependency outages must not bypass or downgrade checks. A degraded mode is acceptable only when it exposes no protected capability and its security properties are explicit and tested.
