# Task journal and handoff

Open a task and select **Journal** to save completed work, decisions, open questions,
next steps or notes. Entries are immutable. **Correct** appends a new entry that
references the earlier one. Closed tasks retain their journal for reading.

## Project journal

Select **Journal** in the main menu to read entries from all tasks in the current
project, including closed tasks, unassigned agent responses and system events. **Search journal entries**
searches the stored entry text, captured requests and responses, agent names,
models and session IDs, including entries not yet loaded. Matching
is literal, case-insensitive and Unicode-normalized; Russian ё and е match.

Use **Filters** to select a task, entry kind, author category (User, Agent or
GitHuman), or creation dates. Dates include the full selected days in your local
time zone. Filters combine with the text search and remain in the URL, so reload
and browser Back restore them. **Reset filters** clears the filters; clear the
search field separately. Scrolling loads older matching entries automatically;
only the visible part of the list is rendered. Click an entry to read its saved request, visible agent response, context
references and provenance. New agent entries and response events retain their
session and response IDs, agent preset identity and title, chat title, model,
reasoning level and reported settings independently of the live chat. Click the
agent name to open its chat while it is still available. Missing model or
reasoning settings are shown as **Not reported**; historical entries without
capture are marked explicitly. User entries have no agent session.

Capture starts with the accepted request. Response events save the text emitted
by the agent, including partial text on cancellation or failure. Agent-authored
semantic entries save the request and response text available at append time.
Each request and response is capped at 64 KiB UTF-8 and marked when truncated.
Attached context references are retained without binary attachment payloads;
they do not preserve past file contents. Internal model reasoning is not captured.
The saved visible response is not a generated summary or proof of completed work.

The list keeps a stable snapshot while you read. When the journal changes,
**Journal changed. Refresh entries** offers to load the latest snapshot. The
refresh button also updates the list. Corrected entries stay visible and marked,
even when their corrections fall outside the search results. Click a task title
to open that task's Journal tab, where you can append or correct entries if the
task is open. The project journal itself is read-only and does not change a
chat's task assignment.

Agents use `tasks.journal_list` and `tasks.journal_append` on the existing GitHuman
MCP bridge. Before writing, read `tasks.get_context` and supply its `turnId` and an
explicit `taskId` from that response. Changing a task in the UI affects the next
response; it does not redirect an entry of the response already in progress.
Validators cannot use these tools. A finished response is a system fact, not a
claim that the task is complete. System facts have the `system` author and an
`eventType`: `turn_finished`, `turn_cancelled`, `turn_failed`,
`handoff_completed` or `handoff_failed`. The journal is append-only, so a handoff
that fails after its completion fact gets a separate `handoff_failed` fact.

An ordinary agent response without a task writes one project
entry marked **No task**. It retains the same request, visible response and agent
provenance. Specialized artifact validators never write response events. Events
are saved when a response finishes, is cancelled or fails; previously unrecorded
responses are not backfilled.

## Continue with another agent

Use **Continue in a new chat** next to the message input. It is available for an
ordinary chat waiting for input or stopped after an error or process failure.
It is disabled while the agent is working, waiting for a tool permission, or
already preparing a handoff. No selected task is required.

Choose the new chat name and harness, preview the captured context, then select
**Transfer and continue**. GitHuman opens the successor tab and automatically
sends an English service prompt asking the new agent to recover the user's goal,
briefly summarize the current state, and continue the unfinished work. The stopped
agent is not asked to generate a summary.

The bounded snapshot starts with the original user request and the latest request
of the source session. It packs recent unique journal entries in chronological
order within the remaining 64 KiB UTF-8 budget. Repeated task copies of the same
response event are included once. Long per-entry request/response context is
marked as truncated; older entries and complete saved context remain accessible
with **sessions.journal_list** using the snapshot's exact `storeId`, `sessionId`
and `throughSeq`. Follow `nextBeforeSeq` as `beforeSeq` to read older pages. The
project journal HTTP search also accepts an exact `sessionId` filter.

The inherited task assignment can contain zero, one or several tasks. The source
history must not change between preview and confirmation; refresh the preview if
it does. Draft text is kept in the original chat and is not sent to the successor.
Captured journal history can already contain truncation and does not preserve
binary attachments or hidden reasoning. A byte budget cannot guarantee that the
snapshot fits every model's context window.

After successful preparation the source becomes read-only until the immediate
successor is closed or its process fails. For A → B → C, closing C unlocks B;
closing B unlocks A. A failed startup leaves the source available. The five-chat
limit applies; no source is closed automatically to make room. When all slots
are in use, close a chat and confirm the same preview again.

The server owns the automatic first prompt. Repeated confirmation refers to the
same operation and never sends it again. Interrupted handoffs do not restart or
resend prompts automatically. The original task-based HTTP API remains available
for compatibility and retains its manual-first-message behavior; its buttons are
removed from the task pane and chat header.

## Storage and recovery

Journal rows and handoff snapshots live in the existing project SQLite database,
scoped by `storeId`. Journal entries do not enter the artifact catalog or change
its validation graph. Journal pagination uses sequence boundaries rather than a
catalog epoch. Entry text is limited to 8 KiB; pages are bounded separately.

Full chat transcripts, tool output and attachments still live in memory;
the captured journal context persists in the database. After closing a chat or restarting
the server, continue from the task and its persistent journal. Interrupted
handoffs do not restart an agent or send prompts automatically. A ready handoff
receipt can refer to a chat that is no longer available.

A preparing handoff whose server stopped is shown as interrupted when it is read;
periodic maintenance stores that state. Previews have no separate expired or
cancelled state: confirmation after ten minutes is refused, and **Refresh**
creates a new preview. Maintenance removes expired previews, and finished
receipts with their snapshots after seven days. A repeated request after that
period starts a new operation.

Automatic provider switching, subscription-limit rules, intercom, roles, vector
memory and model-generated summaries are outside this feature.

### Agent trajectory (stage 0132)

Ordinary agent responses append observed messages, provider explanations, tool
inputs and results, status updates, plans and permission answers as `agent_event`
facts while the response is running. Each fact retains its session and response
identities; tool and permission identifiers remain in the details. Journal sequence
numbers order observations. Events already saved remain available after a chat
closes or the process stops. Artifact validators are excluded.

Details expand in both journal views and participate in journal text search.
Each event retains at most 8 KiB of UTF-8 text, with `[truncated]` marking omitted
data. Structured credential fields and known session bridge keys are redacted;
arbitrary text can still contain sensitive information. Attachments are represented
by references in the request event rather than their binary payloads. Hidden model
reasoning is unavailable; explanations exist only when the provider sends them.
Older responses have no reconstructed trajectory. Stream chunks remain separate
observations, and an incomplete tool has no invented completion event.

Every agent activity event stores a compact snapshot of its harness, model and
settings, without duplicating the request and response text. For older events,
readers recover metadata from the saved outcome of the same session and response,
within the requested journal snapshot. Search and filters use the same metadata.
If that historical snapshot is unavailable, the UI shows unknown values rather
than the current chat settings. Journal list icons distinguish entry categories,
messages, thoughts and response outcomes.
