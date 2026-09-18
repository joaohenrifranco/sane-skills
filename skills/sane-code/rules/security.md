# Security Rules

Portable guidance for confidentiality, integrity, availability, and trust boundaries.

### [SANE-SEC-01] Treat external input as untrusted

Validate type, size, range, encoding, and business constraints for users, networks, files, environment variables, queues, and third-party services. Client validation improves usability but never replaces trusted-side enforcement.

### [SANE-SEC-02] Authenticate and authorize every protected operation

Authentication establishes identity; authorization establishes permission for the specific resource and action. Check ownership, role, scope, tenant, and resource state at the operation boundary. Fail closed when identity or permission is uncertain.

### [SANE-SEC-03] Enforce least privilege

Grant users, services, processes, tokens, data objects, and workflows only the permissions required for their purpose. Default to denial and keep read, write, administrative, and deployment capabilities distinct.

### [SANE-SEC-04] Keep secrets out of source and client artifacts

Never commit credentials, keys, tokens, passwords, or sensitive connection details. Prevent secrets from reaching bundles, logs, telemetry, URLs, errors, responses, and build artifacts; use an approved secret mechanism and rotate suspected exposure.

### [SANE-SEC-05] Parameterize dynamic operations

Pass data as parameters rather than concatenating it into SQL, shell commands, queries, templates, regular expressions, paths, or generated code. If dynamic identifiers are unavoidable, use a trusted allowlist and the system's safe escaping mechanism.

### [SANE-SEC-06] Verify callback authenticity before side effects

Webhook, callback, message, and file-processing endpoints verify authenticity, integrity, freshness, and intended audience before acting. Reject missing, invalid, expired, replayed, or incorrectly scoped credentials.

### [SANE-SEC-07] Encode output for its destination

Escape or encode untrusted data for HTML, attributes, URLs, scripts, SQL, shells, logs, and structured documents. Do not bypass escaping with raw HTML or dynamic evaluation unless content is trusted, narrowly controlled, and sanitized.

### [SANE-SEC-08] Minimize sensitive data

Collect, retain, transmit, and expose only what the purpose requires. Redact secrets and personal data from logs, notifications, telemetry, errors, debug output, and fixtures; define retention where sensitive data is stored.

### [SANE-SEC-09] Protect resources from abuse

Limit request and upload size, execution time, concurrency, pagination, retries, and expensive unauthenticated work. Handle rate limits and quotas deliberately; avoid unbounded queries, recursion, memory growth, and external calls.

### [SANE-SEC-10] Observe failures without leaking details

Record structured information sufficient to investigate security failures without exposing stack traces, credentials, topology, sensitive identifiers, or attacker-controlled content to users or logs.

### [SANE-SEC-11] Review dependencies and delivery systems

Review dependency and lockfile changes, install/build scripts, artifact provenance, workflow permissions, trusted inputs, and protected credentials. CI/CD follows least privilege.

### [SANE-SEC-12] Preserve security during partial failure

Timeouts, missing configuration, retries, dependency failures, and deployments must not bypass checks or expose resources. Define revocation, cleanup, rollback, and session invalidation for security-sensitive failures.

## Review checklist

List trust boundaries and data crossing them; inspect authentication/authorization, secret flow, dynamic operations, output encoding, limits, fail-open behavior, dependencies, and CI/CD permissions.