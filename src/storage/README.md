# Memory session recovery

`exportSession` retains `requests`, the complete original append batches in commit order,
alongside the journal, effects and receipts. Request IDs are independent of an event's
`causedBy`, so the journal alone cannot reconstruct the command idempotency index.
`restoreSession` replays those requests through the same `commitBatch` CAS, protocol,
identity and outbox checks used by normal writes. It verifies that they reproduce the
exported journal and content before publishing the session or its rebuilt request index.
A retry with the original request ID and content returns the original outcome with
`disposition: duplicate`, even after later commits or another export/restore cycle.
Different content under that ID returns `EFK_IDEMPOTENCY_COLLISION`.

`requests` is required local export metadata, not a change to the frozen wire `Event`.
Exports without it are refused with `EFK_SCHEMA_INVALID`; there is no silent migration
or reconstruction from `causedBy`. Session review exports must carry it as well.
Restore refuses duplicate event/effect/receipt/request identities and shared effect
idempotency keys before constructing maps. Identity spelling uses the frozen ASCII
`Id` codec: whitespace and Unicode aliases are rejected rather than normalized.
Canonical content comparison distinguishes identical duplicates from conflicting ones;
neither can silently replace a map entry. The same effect and receipt identity checks
also run during normal append, including collisions inside one batch.
