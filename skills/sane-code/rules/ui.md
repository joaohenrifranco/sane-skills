# UI Rules

Opinionated defaults for user interfaces that stay correct under asynchrony, work for every user, and adapt to the environment they run in.

### [SANE-UI-DERIVE-STATE] Derive displayed values; synchronize only with external systems

Compute a displayed value from its source instead of copying it into parallel state and keeping the copy in sync with an effect. Reserve effects for synchronizing with something outside the view, such as a subscription, a timer, or a platform API, and give each effect a cleanup. Every piece of state, whether remote data, local interaction state, or navigation state, has one owner and one update path (`SANE-ARCH-SINGLE-STATE-OWNER`).

### [SANE-UI-ASYNC-STATES] Define every state of asynchronous data

A view that depends on asynchronous data defines its loading, empty, error, and stale or partial states, and distinguishes "nothing found" from "could not load". Never show a blank screen or old data as current after a failure. A late response must not overwrite a newer one, so cancel or ignore superseded requests (`SANE-CORRECT-CANCELLATION-OWNERSHIP`).

### [SANE-UI-ACTION-FEEDBACK] Give user actions pending, failure, and retry behavior

An action with side effects shows that it is in progress, prevents accidental duplicate submission, and reports failure in a way that lets the user retry or recover. An optimistic update defines how it rolls back and reconciles with the authoritative result. Disabling a control in the interface does not replace server-side idempotency (`SANE-CORRECT-AT-LEAST-ONCE`).

### [SANE-UI-ACCESSIBLE-BY-DEFAULT] Build accessibility into the control

Use semantic, labeled, keyboard-operable controls with visible focus, sufficient contrast, and touch targets large enough to hit reliably. Honor reduced-motion and text-scaling preferences. A custom control must reproduce the full semantics of the native one it replaces, otherwise use the native one; accessibility is part of done, not a later pass.

### [SANE-UI-USER-TEXT] Route user-facing text through localization

Every string a user reads goes through the localization mechanism as a whole message with its own plural and gender forms, and dates, numbers, and currency are formatted for the user's locale. Do not assemble sentences from fragments or hard-code text in views. Show users an actionable message, never an internal error string, identifier, or stack trace.

### [SANE-UI-ENVIRONMENT-ADAPTIVE] Adapt to viewport, insets, and input modality

Layout and interaction must hold at the smallest supported viewport and respect safe areas, dynamic toolbars, and the on-screen keyboard. Do not depend on hover as the only way to reach an action, or on a pointer being present. Verify the smallest and largest supported environments rather than assuming the one used during development.
