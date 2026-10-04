// This is just an example,
// so you can safely delete all default props below

export default {
  failed: 'Action failed',
  success: 'Action was successful',

  common: {
    copyPath: 'Copy file path'
  },

  app: {
    title: 'GitHuman'
  },
  nav: {
    agent: 'Agent chat',
    menu: 'Toggle menu',
    changes: 'Changes',
    reviews: 'Reviews'
  },
  theme: {
    switchToLight: 'Light theme',
    switchToDark: 'Dark theme'
  },
  changes: {
    staged: 'Staged',
    unstaged: 'Unstaged',
    filterPlaceholder: 'Filter files...',
    emptyFileList: 'No changed files',
    emptyDiffPanel: 'No changes to display',
    filesChanged: '{count} files changed',
    additions: 'additions',
    deletions: 'deletions',
    added: 'added',
    modified: 'modified',
    deletedPlural: 'deleted',
    renamed: 'renamed',
    expandAll: 'Expand all',
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
    title: 'Agent',
    unavailable: 'not installed',
    placeholder: "Message the agent…  (Enter to send, {'@'} for files)",
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
      mentionFile: 'Mention a file',
      download: 'Download',
      downloadTitle: 'Download this file?',
      downloadMessage: '"{name}" will be saved to your computer.',
      tooLarge: '"{name}" is larger than {mb} MB',
      readFailed: 'Could not read the file'
    },
    mention: {
      list: 'Files',
      noFiles: 'No matching files',
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
      add: 'Add to agent chat',
      file: 'File: {path}',
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
