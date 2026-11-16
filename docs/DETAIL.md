# dsh-session-hub plugin detail

## What it does

Gives every session one `session` tool: browse session lists, turn digests, and full dialogs; create, rename, message, interrupt, archive, unarchive, or pin other sessions by id.

Three value-adds:

- **Collaborator indicator**: the session header shows "N collaborators" with a hover list of exchanged sessions (title, status, last-exchange time, direction); click to jump. Bidirectional, deduped by session id.
- **Auto receipt**: pass `receipt: true` on `send`; when the target session's turn naturally ends, its final reply is delivered back to the sender and wakes it.
- **Sender attribution**: each message's first line is a native DSH session-reference mention of the sender.

## Security model

- Subagent sessions are rejected (owned by the subagent router).
- Archived sessions must be unarchived first.
- Sends are same-cwd by default; cross-directory sends require an explicit `cwd`.
- A→B→A loops are rejected; one auto receipt per session pair per process lifetime.

## Compatibility

- `engines.dsh: '>=0.2.0'` (SemVer range, checked by the DSH launcher).
- Pure plugin: zero DSH source changes; only public services (`tools`, `sessionController`, `sessionProjections`, `agents`, `sessions`, client `slots`/`locale`).
