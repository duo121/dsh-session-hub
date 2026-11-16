# dsh-session-hub plugin detail

## What it does

Gives every session one `session` tool: browse session lists, turn digests, and full dialogs; create, rename, message, interrupt, archive, unarchive, or pin other sessions by id.

## Three value-adds

**Collaborator indicator**: the session header shows "N collaborators" beside "N subagents". It records exchanges in both directions (sent and received), deduped by session id, ordered by most recent exchange.

- The leading slot is an activity indicator: the collaborators icon when idle, a spinner while any collaborator is running — mutually exclusive, matching how DSH renders subagents and background jobs.
- Hover to expand the list; each row shows direction (`→` sent / `←` received), title, relative time, and run state. Click to jump.
- Archived sessions stay in the list marked "Archived". DSH cannot retain a reference to an archived session, so clicking shows a hint to unarchive first instead of silently changing your archive state.
- Keyboard: `↓` opens and focuses the first row; `Esc` closes.

**Auto receipt**: pass `receipt: true` on `send`; when the target session's turn naturally ends, its final reply is delivered back to the sender, waking or queueing according to its state. One auto receipt per session pair per process lifetime; interrupted or failed turns do not reply.

**Sender attribution**: each message's first line is the sender's session reference (`来自 @[title](dsh-session:…)`), rendered by DSH as a native session chip so the receiver can tell it is not the user.

## Security model

- Sending to your own session is rejected: a session is never its own collaborator, and it never enters the collaborator list.
- Subagent sessions are rejected (owned by the subagent router).
- Archived sessions must be unarchived before messaging.
- Sends are same-cwd by default; cross-directory sends require an explicit `cwd`.
- A→B→A loops are rejected; auto receipts use an in-process per-pair ledger (reset on restart).

## Compatibility

- `engines.dsh: '>=0.2.0'` (SemVer range, checked by the DSH launcher).
- Pure plugin: zero DSH source changes; only public services (`tools`, `sessionController`, `sessionProjections`, `agents`, `sessions`, client `slots`/`locale`/`uiWorkspace`).
- For local mounting, the `name` in `package.json`, the bundle name in `cordis.patch.yml`, and the module `id` at the top of `client.js` must all match.
