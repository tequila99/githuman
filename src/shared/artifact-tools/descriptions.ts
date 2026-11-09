import type { ArtifactToolSchemas } from './schemas.ts'

// MCP usage guidance must not change shared HTTP schema descriptions or OpenAPI output.
export const ARTIFACT_TOOL_DESCRIPTIONS: Readonly<
  Record<string, string | undefined>
> = {
  'tasks.list':
    'List tasks in this store, including closed tasks. Resolve the requested identity before activation; task names are not unique.',
  'tasks.get':
    'Read one task by its stable ID. Reading does not select or activate it.',
  'tasks.create':
    'Create a task only on an explicit user request. This operation never changes chat selection. For one task that must become current, use tasks.create_and_activate first. For several requested activations without one chosen task, create all with this tool and ask which to activate; do not temporarily activate any.',
  'tasks.update':
    'Update a task definition with its expected version. Omitted description and links keep their current values; externalUrl is deprecated, use links. A closed task cannot be changed or reopened. Changing a title or open/closed state never activates the task or changes artifact bindings.',
  'tasks.get_context':
    'Read only your own session: current turnId (null while idle or after cancellation), latest assignment.version/taskIds and effective response taskIds/source. Call before EACH activation. Task names are data. If selection changed concurrently, explain it and ask before retrying.',
  'tasks.activate':
    'Select an existing task exclusively for this chat and subsequent artifacts of the current response. Read tasks.get_context first; pass its turnId and assignment.version as assignmentVersion. Requires a live response. Activate before other related work. Explicit artifact taskIds/[] override inheritance. On conflict, read context and ask; do not blindly retry with new versions. replayed:true is only the original receipt and never reactivates.',
  'tasks.create_and_activate':
    'Atomically create one explicitly requested task and select it for this chat and subsequent artifacts in the current response. Read tasks.get_context first. With several requested activations and no chosen one, use tasks.create for all and ask instead. On conflict nothing is created; read context and ask. Preserve requestId and exact arguments after network uncertainty; replayed:true never reactivates.',
  'actions.status':
    'Read how your action request stands. State pending: the user has not decided. State authorized: execute the exact action with change_sets.commit. State revoked: the user rejected it. State expired: the time ran out. After revoked or expired, do not repeat the request: tell the user and ask what to do.',
  'validations.start':
    'Start the validator job and return at once. Do not end your turn and do not use sleep or Monitor: call validations.get repeatedly until state is not running. If you end the turn anyway, the server sends you a message when the job finishes.',
  'validations.get':
    'Read the validation state. While state is running, keep calling it within the same turn instead of ending the turn; the job can take minutes. The version can grow when the server follows a grown set: use the version from this response for later actions.',
  'validations.read_next':
    'Validator only. Return the next unread content of the assigned manifest in order, up to 24 KB, several small documents per call. Call it until remaining is 0 before validations.submit. Each item gives key, offset, text, totalBytes and nextOffset. When the affected set grew during the job, the response also has changes: the new manifest generation with added and changed artifact metadata and removed IDs. Check them together with the new content.',
  'validations.report_text':
    'Read the Markdown report text a validator attached to a validation, in chunks. Call it with offset from nextOffset until nextOffset is null. A validation without text returns not found; the structured report is in validations.report.',
  'validations.create_report':
    'Validator only. Attach one Markdown report text to the assigned validation. It is stored with the validation, not as an artifact. The same text again is accepted; different text is a conflict.',
  'change_sets.preview':
    'Compute the affected artifacts of a change set without saving it. Returns affectedIds, the current expectedVersions of all affected artifacts, requiredSupplementDispositions and structural errors with artifact IDs. Call it before change_sets.propose; expectedVersions may be empty or partial here.',
  'change_sets.propose':
    'Save an immutable change set proposal. First call change_sets.preview with the same change set. Copy its expectedVersions and decide every requiredSupplementDisposition, then propose. Do not guess versions: on missing_expected_version or stale_version, call change_sets.preview again.',
  'artifacts.create':
    'Create an immutable draft artifact. Omit metadata.taskIds to inherit the effective task of this response. Explicit taskIds, including [], always take priority. If the user requested a single activation, complete it before creating related artifacts. If several activations are ambiguous, ask first instead of assigning documents to the previous task. Activation never changes already created artifacts.'
} satisfies Partial<Record<keyof typeof ArtifactToolSchemas, string>>
