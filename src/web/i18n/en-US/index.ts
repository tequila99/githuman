// This is just an example,
// so you can safely delete all default props below

export default {
  workspace: {
    selectLines: 'Select comment lines',
    extendSelection: 'Tap another line number to extend the selection',
    commentRange: 'Comment lines {start}–{end}',
    cancelSelection: 'Cancel',
    selectionChanged: 'The selected lines changed. Select them again.',
    list: 'Files',
    note: 'Note',
    file: 'File',
    working: 'Agent is working',
    back: 'Back to workspace',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    fullscreenFailed: 'Could not enter fullscreen'
  },
  artifacts: {
    export: {
      menu: 'Download artifact',
      original: 'Original Markdown file',
      history: 'Metadata and full history (JSON)'
    },
    addToAgent: 'Add artifact to agent chat',
    content: {
      loading: 'Reading the artifact…',
      failed: 'Could not read the artifact text',
      integrity: 'The stored artifact failed its integrity check',
      hint: 'The metadata and the history stay available. Retry or Refresh reads the text again; background updates do not.',
      retry: 'Retry',
      verifying: 'Checking the artifact text',
      blocked: 'Unavailable: the stored artifact failed its integrity check'
    },
    transition: {
      button: 'Status: {status}. Change status',
      menuTitle: 'Change status to',
      none: 'No status changes available',
      dialogTitle: 'Change status',
      question: 'Change “{title}” from {from} to {to}?',
      changes: 'Status changes',
      change: '{title}: {from} → {to}',
      loading: 'Loading consequences…',
      blocked: 'This change cannot start',
      blockedHint:
        'Resolve the active supplements first. This screen cannot choose their decisions.',
      validator: 'Validator',
      validatorHint:
        'The validator checks the change first. The status changes only after it passes.',
      validatorNone: 'No validator agent is available.',
      yes: 'Yes',
      no: 'No',
      refresh: 'Refresh consequences',
      refreshed: 'The artifacts changed, so the consequences were refreshed.',
      expired: 'This preview expired. Refresh the consequences.',
      startFailed: 'Could not start the change',
      stages: {
        preparing: 'Preparing',
        validating: 'Validating',
        applying: 'Applying',
        succeeded: 'Status changed',
        failed: 'Not changed',
        cancelled: 'Cancelled',
        interrupted: 'Interrupted'
      },
      progressLabel: 'Status change to {to}',
      cancel: 'Cancel',
      cancelRequested: 'Cancelling…',
      retry: 'Retry',
      dismiss: 'Dismiss',
      report: 'Open the validation report artifact',
      loadFailed: 'Could not load the status menu',
      loadingMenu: 'Loading status menu…',
      reload: 'Reload',
      result: 'Validation result',
      resultLoading: 'Loading the validation result…',
      resultFailed: 'Could not load the validation result',
      resultEmpty: 'The validator saved no findings.',
      reportText: 'Report text',
      reportTextFailed: 'Could not load the report text',
      findings: 'Findings',
      resolutions: 'Resolutions',
      close: 'Close'
    },
    actions: {
      empty: 'No pending requests.',
      version: 'Version {version}',
      digest: 'Change digest',
      proposedBy: 'Proposed by',
      subjects: 'Command subjects',
      expectedVersions: 'Expected metadata versions',
      dispositions: 'Decisions for active supplements',
      verdict: 'Verdict',
      validator: 'Validator',
      queueUntil: 'until {time}',
      queueDocuments: '{count} artifact | {count} artifacts',
      applied:
        'Applied: the change was committed and this authorization is consumed.',
      confirmScope:
        'I reviewed this exact action, its affected artifacts and supplement decisions.',
      approve: 'Authorize this action',
      apply: 'Apply approved action',
      queueTitle: 'Artifact action requests',
      queueCount: '{count} pending',
      queueLoadFailed: 'Could not load action requests',
      queueRetry: 'Retry',
      queueClose: 'Close requests',
      back: 'Back to requests',
      sourceChat: 'Requested by chat',
      reason: 'Reason',
      timeLeft:
        'The request expires at {time}. The permission shares this deadline and is not extended.',
      expired: 'This request expired. Ask the agent for a new one.',
      changes: 'Artifacts that change: {count}',
      checkedOnly: 'Artifacts checked without a status change: {count}',
      relationChanges: 'Relationship lists replaced: {count}',
      details: 'Technical details',
      scopeFailed: 'Could not read the request',
      unavailable: 'This request is no longer available.',
      blocked: 'The server blocks this request: {problem}',
      granted:
        'Permission passed to the agent. The agent applies it in its own session. You can still revoke it while it exists.',
      grantedRefreshFailed:
        'The permission was granted, but the result could not be read back: {error}',
      revokedNote: 'Request rejected. No artifacts changed.',
      refreshScope: 'Refresh',
      reject: 'Reject',
      reportTitle: 'Validation report',
      noSession: 'Session {id}',
      selectRequest: 'Select a request to review its exact package.',
      emptyHint: 'Requests from agents appear here.',
      states: {
        prepared: 'Prepared',
        running: 'Running',
        pass: 'Pass',
        conflict: 'Conflict',
        incomplete: 'Incomplete',
        cancelled: 'Cancelled'
      },
      commands: {
        return_to_draft: 'Return to draft',
        reject: 'Reject',
        accept: 'Accept',
        archive: 'Archive',
        delete: 'Delete',
        restore: 'Restore to draft',
        update_relations: 'Update relationships'
      }
    },
    definitions: {
      task: 'Task',
      type: 'Artifact type',
      closed: 'Closed',
      inactive: 'Inactive',
      noMatches: 'No matching entries.',
      unavailable: 'This definition is unavailable. Its ID is preserved.'
    },
    details: {
      metadata: 'Current metadata',
      currentTitle: 'Current title',
      tasks: 'Tasks',
      none: 'None',
      version: 'Metadata version',
      sourcePath: 'Original path (informational)',
      created: 'Created at',
      updated: 'Metadata updated at',
      bytes: 'Original size (bytes)',
      outgoing: 'Outgoing relationships',
      incoming: 'Incoming relationships',
      lineage: 'Revision ancestry',
      history: 'Metadata history',
      eventVersion: 'Version {version}',
      recordedMetadata: 'Recorded metadata',
      noHistory: 'No recorded metadata events.',
      stale: 'These details are out of date. Refresh before reading more.',
      kinds: {
        parent: 'Parent',
        replaces: 'Replaces',
        supplements: 'Supplements',
        references: 'References'
      },
      actions: { created: 'Created', metadata_updated: 'Metadata updated' }
    },
    title: 'Artifacts',
    activeStatuses: 'All except archived and deleted',
    allStatuses: 'All statuses',
    document: 'Artifact',
    search: 'Search artifacts',
    status: 'Status',
    type: 'Type ID',
    task: 'Task ID',
    tag: 'Tag',
    types: 'Artifact types',
    createdFrom: 'Created from',
    createdTo: 'Created to',
    group: 'Group loaded results',
    groupByTask: 'Group by task',
    typos: 'Include typo matches',
    refresh: 'Refresh',
    more: 'Load more',
    select: 'Select an artifact to read it.',
    empty: 'No matching artifacts.',
    agentCreates: 'Ask an agent to create an artifact.',
    currentMetadata: 'Current metadata.',
    identity: 'Artifact ID',
    store: 'Store ID',
    noTask: 'No task',
    fuzzyMatch: 'Typo match',
    stale: 'These results are out of date. Refresh the list.',
    partial: 'The search budget was reached. Some typo matches may be missing.',
    statuses: {
      draft: 'Draft',
      in_review: 'In review',
      accepted: 'Accepted',
      rejected: 'Rejected',
      superseded: 'Superseded',
      archived: 'Archived',
      deleted: 'Deleted'
    },
    groups: { none: 'No grouping', type: 'Type', task: 'Task' }
  },
  markdown: {
    unsupported: 'This text cannot be edited visually and is shown read-only.',
    insertLink: 'Insert link to a note or artifact',
    findLink: 'Find a note or artifact to link',
    noMatches: 'No matching notes or artifacts'
  },
  tasks: {
    title: 'Tasks',
    search: 'Search tasks',
    refresh: 'Refresh tasks',
    empty: 'No tasks.',
    more: 'Load more',
    new: 'New task',
    create: 'Create',
    cancel: 'Cancel',
    choose: 'Choose a task',
    loading: 'Loading the task…',
    titleField: 'Title',
    description: 'Description',
    addToAgent: 'Add task to agent chat',
    copyId: 'Copy task ID',
    idCopied: 'Task ID copied',
    reload: 'Reload',
    filter: { all: 'All', open: 'Open', closed: 'Closed' },
    state: { label: 'State', open: 'Open', closed: 'Closed' },
    transition: {
      button: 'Task state: {state}. Change state',
      menuTitle: 'Change state'
    },
    status: {
      saved: 'Saved',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      error: 'Not saved',
      conflict: 'Conflict',
      emptyTitle: 'Enter a title to save',
      conflictHint:
        'The task changed elsewhere. Reload to see the new version; your unsaved edits will be replaced.'
    },
    links: {
      title: 'External links',
      none: 'No links.',
      url: 'URL',
      label: 'Label',
      add: 'Add link',
      remove: 'Remove link'
    },
    artifacts: {
      title: 'Artifacts',
      tab: 'Artifacts',
      none: 'No artifacts are linked to this task.',
      count: 'Artifacts: {count}',
      add: 'Add artifact',
      remove: 'Unlink artifact',
      removeHint: 'Unlink from this task. The artifact itself is kept.',
      searchWithinTask: 'Search artifacts in this task',
      search: 'Search artifacts',
      noCandidates: 'No matching artifacts.',
      activeHint:
        'An accepted artifact needs a validated change set to change its tasks.',
      closedHint: 'A closed task cannot get new artifacts.'
    },
    close: {
      action: 'Close task',
      title: 'Close this task?',
      hint: 'A closed task cannot be reopened. Create a new task and link the artifacts to it if work continues.',
      required: 'Artifacts used only by this task — archive them first',
      requiredDone: 'All artifacts of this task are archived.',
      optional: 'Artifacts also used by other tasks',
      optionalHint: 'Archive these only if you want to.',
      confirm: 'Close task'
    }
  },
  notes: {
    externalAssets: {
      title: 'Download external attachments',
      empty: 'Document contains no external attachments',
      unknownSize: 'Size unknown',
      size: '{size} MB',
      occurrences: '{count} occurrences',
      limits:
        'Images: up to 10 MB. PDFs: up to 50 MB, or 100 MB with confirmation. Up to 200 MB per operation.',
      selectAll: 'Select all',
      selectNone: 'Deselect all',
      download: 'Download selected',
      close: 'Close',
      stop: 'Stop and keep completed downloads',
      restore: 'Restore external links',
      result: 'Replaced {count} links',
      largeWarning: 'This PDF exceeds 50 MB. Download it with a 100 MB limit?',
      confirmLarge: 'Download large PDF',
      skip: 'Skip',
      previewFailed:
        'Preview is unavailable. It loads again when you scroll back.',
      states: {
        pending: 'Ready',
        loading: 'Downloading…',
        confirmation: 'Confirmation required',
        stored: 'Downloaded',
        done: 'Link replaced',
        error: 'Failed',
        skipped: 'Skipped'
      },
      errors: {
        'operation-limit': 'The operation exceeds its 200 MB budget.',
        'file-too-large': 'The file exceeds its size limit.'
      }
    },
    delete: 'Delete',
    deleteFailed: 'Could not delete the note',
    moveFailed: 'Could not move the note',
    parentFolder: 'Parent folder',
    noteNameHint:
      'Create in {folder}. Enter a file name; .md is added automatically.',
    folderNameHint: 'Create in {folder}. Enter a folder name without a path.',

    addToAgent: 'Add to agent',
    back: 'Back',
    forward: 'Forward',
    absentNote: 'The file is missing. It may have been deleted or moved.',
    deletedNote: 'This note was deleted.',
    backlinks: 'Linked from',
    previousNote: 'This is the previous note',
    newIdentity: 'This is a new note',
    repairLinks: 'Retry link repairs',
    later: 'Later',
    selectedHidden: 'The selected note is hidden by the current filter.',

    movedFile: 'Moved file',
    confirmDeletion: 'Confirm deletion',
    moreIssues: 'More issues',
    moveFolder: 'Move to another folder',
    destinationFolder: 'Destination folder (empty for root)',
    rename: 'Rename',
    cancelRename: 'Cancel',
    newName: 'New name',
    invalidName: 'Enter a name without slashes or a leading dot.',
    title: 'Notes',
    unsupported:
      'This note uses Markdown that is not supported by the visual editor. Edit the source to keep its content.',
    tags: 'Tags',
    properties: 'Properties',
    addProperty: 'Add property',
    propertyName: 'Property name',
    propertyType: 'Type',
    removeProperty: 'Remove property',
    removePropertyValue: 'Remove {value}',
    editProperty: 'Edit property',
    propertyEmpty: 'Empty',
    propertySource: 'Edit in Markdown source',
    propertyTypes: {
      text: 'Text',
      list: 'List',
      number: 'Number',
      boolean: 'Checkbox',
      date: 'Date'
    },
    done: 'Done',
    newNote: 'New note',
    newFolder: 'New folder',
    root: 'Notes root',
    folderEmpty:
      'This folder is empty. Create a note or folder to get started.',
    search: 'Find a note',
    noMatches: 'No matching notes',
    empty: 'No notes yet. Create a note to get started.',
    choose: 'Choose a note or create a new one.',
    loading: 'Loading…',
    findLink: 'Find a note to link',
    insertLink: 'Link to note',
    view: 'View',
    visual: 'Edit',
    source: 'Markdown source',
    retry: 'Retry',
    loadDisk: 'Load disk version',
    saveCopy: 'Save draft as a new note',
    compare: 'Compare versions',
    draft: 'Your draft',
    disk: 'On disk',
    missing: 'The disk version is unavailable.',
    pathHint: 'Path relative to notes, for example: plans/next.md',
    discard: 'Discard your draft and load the current file from disk?',
    status: {
      saved: 'Saved',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      error: 'Save failed',
      conflict: 'Conflict'
    }
  },
  windows: {
    downloadFile: 'Download file',
    fileDownloading: 'Download started.',
    fileLinkFailed:
      'Cannot open this link. Choose a file inside the current repository.',
    panel: 'Window panel',
    newTerminalShortcut: 'New terminal tab: Ctrl+Win+T',
    layoutShortcuts: 'Window layout: Ctrl+Win+← / → / ↑ / ↓',
    minimizeAllShortcut: 'Minimize all: Ctrl+Win+M',
    movePanel: 'Move window panel',
    preview: 'Preview',
    minimize: 'Minimize window',
    closeAll: 'Close all previews',
    closeTab: 'Close preview',
    closeAllTitle: 'Close all previews?',
    closeAllMessage: 'Are you sure you want to close all preview tabs?',
    closeTitle: 'Close this preview?',
    closeMessage: 'Are you sure you want to close this preview tab?',
    cancel: 'Cancel',
    empty: 'Open a Markdown file, image or PDF.',
    openFile: 'Open file',
    dropFiles: 'Drop Markdown, images or PDF files here',
    unsupportedFile:
      'Unsupported file: {name}. Choose Markdown, an image or PDF.',
    imageFailed:
      'Could not display this image. Choose a browser-supported image format.',
    pdfPrevious: 'Previous page',
    pdfNext: 'Next page',
    pdfPage: 'Page {page}',
    retry: 'Retry',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    diagram: 'diagram',
    missing: {
      file: 'The file was deleted or moved.',
      message: 'The original message is no longer available.',
      attachment: 'The attachment is no longer available.',
      diagram: 'The diagram is no longer available.',
      binary: 'This file cannot be previewed.'
    }
  },
  terminal: {
    empty: 'No terminal sessions. Use + to create one.',
    keys: {
      title: 'Terminal keys',
      escape: 'Escape',
      tab: 'Tab',
      up: 'Arrow up',
      down: 'Arrow down',
      left: 'Arrow left',
      right: 'Arrow right'
    },
    maximize: 'Maximize',
    restore: 'Restore window',
    menu: 'Terminal menu',
    closeAll: 'Close all terminals',
    closeAllTitle: 'Close all terminals?',
    closeAllMessage:
      'All terminal sessions and their running processes will be stopped.',
    title: 'Terminal',
    command: 'Command (limited mode)',
    send: 'Send command',
    closeTab: 'Close terminal',
    add: 'New terminal',
    closeTitle: 'Close this terminal?',
    closeMessage: 'The shell and its running commands will be stopped.',
    cancel: 'Cancel',
    minimize: 'Minimize terminal',
    originalColors: 'Use original colors (disable minimum contrast)',
    unavailable: 'Terminal connection is unavailable.',
    reconnecting:
      'Reconnecting… Input is disabled until the connection returns.',
    limited:
      'Limited mode: interactive programs are unavailable. Enter commands in the field below; Ctrl+C interrupts, Ctrl+D closes the shell.'
  },
  failed: 'Action failed',
  success: 'Action was successful',

  common: {
    close: 'Close',
    create: 'Create',
    cancel: 'Cancel',
    copyPath: 'Copy file path',
    filters: {
      title: 'Filters',
      reset: 'Reset filters',
      done: 'Done',
      close: 'Close',
      tags: 'Tags',
      tagMode: 'Match tags',
      allTags: 'All tags',
      anyTag: 'Any tag',
      noTags: 'No tags yet.'
    }
  },

  app: {
    title: 'GitHuman'
  },
  nav: {
    agent: 'Agent chat',
    menu: 'Toggle menu',
    artifactActions: 'Artifact action requests',
    changes: 'Changes',
    reviews: 'Reviews'
  },
  theme: {
    switchToLight: 'Light theme',
    switchToDark: 'Dark theme'
  },
  access: {
    title: 'Access from the local network',
    noAccess: 'This device has no access to GitHuman on this computer.',
    nameLabel: 'Device name (optional)',
    request: 'Request access',
    pending:
      'Approve this device on the computer, in a GitHuman tab opened on localhost. Check that the code there is the same:',
    expiresIn: 'The request expires in {time}.',
    ended:
      'The request was rejected or expired. Keep a GitHuman tab open on localhost on the computer, then request access again.',
    unavailable: 'The server is not available.',
    retry: 'Retry',
    requestFailed: 'Could not request access',
    httpWarning:
      'The connection uses plain HTTP. Use it only in a network that you trust.'
  },
  devices: {
    menu: 'Devices',
    title: 'Devices',
    connect: 'Connect a device',
    connectHint:
      'Open this address on the device, or scan the code. The server must listen on the network: githuman serve --host 0.0.0.0',
    noAddresses: 'This computer has no network address.',
    address: 'Network address',
    trusted: 'Trusted devices',
    none: 'No trusted devices.',
    lastSeen: 'Last activity {time}, {address}',
    rename: 'Rename',
    renameTitle: 'Rename device',
    revoke: 'Revoke access',
    revokeTitle: 'Revoke access?',
    revokeMessage:
      '{name} loses access at once. Its open terminal and chats close.',
    cancel: 'Cancel',
    save: 'Save',
    actionFailed: 'Could not change the device',
    request: {
      title: 'A device requests access',
      from: '{name} — {address}, opened as {host}',
      code: 'Code shown on the device',
      expiresIn: 'Expires in {time}',
      expired: 'The request has expired.',
      warning:
        'A trusted device can use the terminal and the agents of this computer. The connection uses plain HTTP.',
      approve: 'Approve',
      reject: 'Reject',
      failed: 'Could not answer the request',
      postponed: 'The request from {name} waits for an answer.',
      answer: 'Answer'
    }
  },
  changes: {
    listMode: {
      tree: 'Tree view',
      folder: 'Folder {path}'
    },
    staged: 'Staged',
    unstaged: 'Unstaged',
    filterPlaceholder: 'Filter files...',
    emptyFileList: 'No changed files',
    emptyDiffPanel: 'No changes to display',
    filesChanged: '{count} file | {count} files',
    additions: 'additions',
    deletions: 'deletions',
    added: 'added',
    modified: 'modified',
    deletedPlural: 'deleted',
    renamed: 'renamed',
    expandAll: 'Expand all',
    expandAllHint:
      'Double-click to expand all files. Keyboard: Enter or Space.',
    collapseAllHint:
      'Double-click to collapse all files. Keyboard: Enter or Space.',
    collapseAll: 'Collapse all',
    binaryFile: 'Binary file not shown',
    fullFileDeleted: 'The file no longer exists on disk',
    fullFileLoadError: 'Could not read the file from disk',
    noTextChanges: 'No text changes',
    hunksLoading: 'Loading the changes of this file',
    hunksLoadError: 'Could not load the changes of this file',
    showFullFile: 'Show full file',
    fileActions: 'File actions',
    previewMarkdown: 'Preview markdown',
    closePreview: 'Close preview',
    previewBinary: 'This file cannot be previewed.',
    wrapLines: 'Wrap long lines',
    loadError: 'Could not load changes',
    retry: 'Retry',
    fileStatus: {
      added: 'Added',
      modified: 'Modified',
      deleted: 'Deleted',
      renamed: 'Renamed'
    },
    actions: {
      stage: 'Stage file',
      unstage: 'Unstage file',
      discard: 'Discard changes',
      stageUnresolvedTitle: 'Unresolved comments',
      stageUnresolvedMessage:
        '{path} has {count} unresolved comment(s) in the active review. Stage it anyway?',
      stageUnresolvedOk: 'Stage anyway',
      discardConfirmTitle: 'Discard changes?',
      discardConfirmMessage:
        'This will permanently discard changes to "{path}". This cannot be undone.',
      discardConfirmOk: 'Discard',
      discardConfirmCancel: 'Cancel',
      stageError: 'Failed to stage file',
      unstageError: 'Failed to unstage file',
      discardError: 'Failed to discard changes'
    }
  },
  browse: {
    toggle: 'Browse full codebase',
    allFiles: 'All files',
    searchPlaceholder: 'Search files...',
    noFiles: 'No files to display',
    treeLoadError: 'Could not load the file tree',
    noMatchingFiles: 'No matching files',
    selectFile: 'Select a file to view its contents'
  },
  reviews: {
    startReview: 'New review',
    status: {
      in_progress: 'In progress',
      approved: 'Approved',
      changes_requested: 'Changes requested'
    },
    confirmStatusChange: {
      title: 'Change review status?',
      message: 'Do you really want to change the review status to "{status}"?',
      ok: 'Change',
      cancel: 'Cancel'
    },
    list: {
      unnamed: 'Unnamed review',
      unknownBranch: 'Unknown branch',
      empty: 'No reviews yet on this branch.',
      emptyAction: 'Go to Changes to start one'
    },
    filters: {
      searchPlaceholder: 'Search by name...',
      from: 'From',
      to: 'To',
      files: 'Files',
      filesHint: 'Type a file path and press Enter'
    },
    create: {
      title: 'New review',
      nameLabel: 'Name (optional)',
      nameHint: 'Auto-generated from the source and current time if left blank',
      submit: 'Create'
    },
    detail: {
      notFound: 'Review not found',
      noComments: 'No commented files in this review yet',
      download: 'Download review',
      downloadError: 'Failed to download review'
    },
    comments: {
      count: '{count} comments',
      line: 'Line {line}',
      lineRange: 'Lines {start}-{end}',
      placeholder: 'Leave a comment...',
      submit: 'Comment',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      delete: 'Delete',
      deleteConfirmTitle: 'Delete comment?',
      deleteConfirmMessage:
        'This will permanently delete this comment. This cannot be undone.',
      deleteConfirmOk: 'Delete',
      deleteConfirmCancel: 'Cancel',
      resolve: 'Resolve',
      unresolve: 'Unresolve',
      resolved: 'Resolved',
      error: 'Failed to save comment'
    }
  },
  agent: {
    tasks: {
      title: 'Tasks ({count})',
      add: 'Add task',
      retry: 'Retry',
      inheritance:
        'Selected task: {task}. New responses inherit it; MCP activation can also select a task for the current response. Explicit artifact tasks take precedence.',
      noInheritance:
        'No task selected for new responses. Without a response activation or explicit tasks, new artifacts will stay unassigned.',
      ambiguousInheritance:
        'Select exactly one task to inherit it automatically. Otherwise, artifacts without explicit tasks will stay unassigned.',
      nextTurn:
        'Manual assignment changes apply to the next message. Only explicit MCP activation changes the task of the current reply.',
      reload: 'Reload assignment and discard draft',
      changed:
        'The assignment changed elsewhere. Load the latest selection before changing tasks.'
    },
    title: 'Agent',
    unavailable: 'not installed',
    placeholder:
      "Message the agent…  (Enter to send, {'@'} for files and folders)",
    send: 'Send',
    cancel: 'Stop',
    thinking: 'Thinking',
    continue: 'Continue',
    status: {
      starting: 'starting',
      ready: 'ready',
      busy: 'working',
      closed: 'closed'
    },
    autoApprovesEdits:
      'This agent edits files without asking for confirmation.',
    reviewStale:
      'Files changed after the review was attached — line numbers in its comments may no longer match.',
    sessionClosed:
      'This chat has ended. Close its tab and start a new chat to continue.',
    startFailed: 'Could not start the chat',
    sendFailed: 'Could not send the message',
    sendBusy:
      'The agent is replying. Your draft stays here. Wait for the reply to finish or stop it, then send your message.',
    resize: 'Resize the agent panel',
    modeHint: 'Shift+Tab switches the mode',
    diagram: {
      title: 'Mermaid diagram',
      close: 'Close',
      failed: 'Could not draw the diagram'
    },
    code: {
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Could not copy to the clipboard'
    },
    config: {
      failed: 'Could not change "{name}"',
      noMatch: 'No matches',
      filter: 'Filter'
    },
    attach: {
      menu: 'Add',
      uploadFile: 'Upload file',
      mentionFile: 'Mention a file or folder',
      download: 'Download',
      downloadTitle: 'Download this file?',
      downloadMessage: '"{name}" will be saved to your computer.',
      tooLarge: '"{name}" is larger than {mb} MB',
      readFailed: 'Could not read the file'
    },
    voice: {
      hold: 'Hold to talk',
      privacy: "The browser's speech service processes the audio.",
      screenReader:
        'Hold Space or Enter to talk. In screen reader browse mode, activate once to start and once to stop.',
      listening: 'Listening',
      finishing: 'Finishing voice input',
      shortcut: 'Hold Win+Alt+Space for voice input',
      inserted: 'Inserted: {text}',
      busy: 'Voice input is busy. Try again in a moment.',
      language: 'Voice input language: {name}',
      error: {
        'not-allowed':
          'Microphone access is blocked. Allow it in the browser and hold the button again.',
        'service-not-allowed':
          'The browser does not allow speech recognition here.',
        'audio-capture': 'No microphone was found.',
        network: "The browser's speech service is not available.",
        'language-not-supported':
          'The speech service does not support this language.',
        other: 'Voice input failed.'
      }
    },
    mention: {
      list: 'Files and folders',
      noFiles: 'No matching files or folders',
      remove: 'Remove {name}'
    },
    permission: {
      title: 'Permission requested',
      cancel: 'Cancel',
      showChanges: 'Show changes'
    },
    autoApprove: {
      tooltipOff: 'Approve the agent’s requests automatically',
      tooltipOn: 'Approving automatically — click to ask again',
      confirmTitle: 'Stop asking for confirmation?',
      confirmMessage:
        'The agent will edit files and run commands in this repository without waiting for your answer. Instructions hidden in the code or diff it reads can steer it. Only do this for work you are ready to review and revert.',
      confirmOk: 'Approve automatically',
      banner: 'This chat approves every request without asking.',
      turnOff: 'Ask again',
      approved: 'Approved automatically: {title}',
      failed: 'Could not change the confirmation setting'
    },
    emptyState: {
      title: 'Add a new chat with an agent',
      hint: 'Attach a diff, a file or a review and ask the agent to act on it.',
      add: 'Add chat'
    },
    newChat: {
      title: 'New chat',
      name: 'Chat name',
      agent: 'Agent',
      context: 'Will be attached to the first message',
      create: 'Create',
      cancel: 'Cancel'
    },
    chats: {
      title: 'Chats',
      add: 'New chat',
      empty: 'No chats yet',
      limitReached:
        'At most {max} chats can be open at once. Close one to add another.',
      close: 'Close chat',
      closeTitle: 'Close this chat?',
      closeMessage:
        '"{name}" will be closed and its agent stopped. The conversation cannot be restored.',
      closeBusy:
        '"{name}" is still working. Closing it stops the agent and discards the answer in progress.',
      keep: 'Keep open',
      closeFailed: 'Could not close the chat',
      needsAnswer: 'waiting for your answer'
    },
    context: {
      artifact: 'Artifact: {name}',
      task: 'Task: {name}',
      add: 'Add to agent chat',
      file: 'File: {path}',
      directory: 'Folder: {path}/',
      diff: 'Diff: {source}',
      diffFile: 'Diff ({source}): {path}',
      review: 'Review with comments',
      attachment: 'File: {name}',
      addFile: 'Add file to chat',
      addDiff: 'Add diff to chat',
      addReview: 'Add review to chat',
      remove: 'Remove'
    },
    tool: {
      failed: 'failed',
      output: 'Output',
      diffTruncated:
        'The diff is cut here: the file is larger than the chat shows.'
    },
    source: {
      staged: 'staged',
      unstaged: 'unstaged'
    }
  }
}
