# WorkspacePort local adapters

Core exports the port and deterministic base/scope/conflict rules from
`src/runtime/workspace/index.ts`. Concrete adapters are imported separately from
`src/workspace/index.ts`; core has no dependency on this directory.

The host explicitly supplies an EventStore, ArtifactStore, DigestPort, Clock,
driver and `resourcePaths` mapping. Frozen `Scope.readResources/writeResources`
are **named resource IDs**, resolved by that mapping to exact relative files or
directory prefixes ending in `/`. Reads/writes validate actual path components
and reject links, traversal, Windows ADS and special files. These adapters accept
UTF-8 text, regular files, and explicit executable modes where supported.

`base → stage → write/diff → seal` creates an isolated candidate bound to the exact
base revision/digest and attempt. Sealing stores immutable bytes using the existing
L2 ArtifactRef/store and binding/privacy gates. Candidate staging does not mutate
integration or existing user/global Skills. Non-Git assets use the same port.

The caller commits the exact effect intention through the L2 EventStore and passes
its AuthorizedEffect plus sealed patch to `apply`. Its scope must cover the patch;
the effect needs the workspace resource lease, live deadline/grant and current
epoch/fencing token. A stale base returns the typed `rebase/replan` disposition,
including both bases and overlapping files (empty for disjoint base drift). No
patch is auto-merged. A contending writer returns `EFK_CLAIM_CONFLICT`; the caller
refreshes/replans explicitly after the first writer finishes.

One local filesystem lock protects each physical integration target across
provider instances/processes. The adapter uses **L2's existing dispatch claim,
outbox projection, applyReceipt and reconcileEffect**, rather than a second
session journal. Operational application records hold observed snapshots and host
receipts; they never decide task success or grant asset qualification.

Git builds real detached worktrees and exact blobs/trees, then produces a commit
with the previous integration commit as parent. Publication is a single
`update-ref <new> <expected-old>` CAS. The integration ref must not be checked out:
consumers read the selected snapshot through the port, not a simultaneously edited
checkout. Hooks, clean filters, signing and line-ending conversion do not produce
the transaction's content. All fixture commits are in temporary repositories.

The filesystem adapter initializes a **new project-local directory**, builds
complete immutable snapshot directories, and replaces `HEAD.json` by same-volume
rename. Readers pin one snapshot. Atomicity is at the Git ref / snapshot-pointer
read surface; arbitrary readers of candidate directories have no such guarantee.

Actual success produces a standard Receipt plus a WorkspaceApplication artifact
with before/after snapshot identities. `undo` requires a new committed, authorized
effect and the exact receipt evidence; it creates a fresh revision restoring old
bytes, preserving history and avoiding revision ABA. Later journal-confirmed
applications can explain superseded receipts; unmanaged changes stay unknown.

Unknown effects are never re-applied. `reconcile` compares journal intention,
receipt evidence, and actual snapshot bytes before resolving. Recovery does not
publish a candidate. Writer locks are not stolen on a timeout: the local process
must be dead, or the originating provider instance must be idle. Missing owner or
application evidence remains unknown and requires explicit inspection.

Evidence in `test/l3-workspace-*.test.js` uses real local FS/Git and process kills.
The test harness persists **exports of L2's memory reference store** after CAS;
this is not a production durable EventStore backend or cross-process database CAS
claim. The host must inject its separately qualified backend in production.

These are **same-user workspaces, not OS sandboxes**. No protection against an
arbitrary same-user process, cross-machine lock protocol, power-loss durability,
exactly-once external side effects, asset promotion, or native host activation is
claimed. Git refs and fs snapshots are project-local publication receipts; asset
qualification/ActivationDecision and global Skills changes belong to other lanes.
