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
    noTextChanges: 'No text changes',
    showFullFile: 'Show full file',
    fileActions: 'File actions',
    wrapLines: 'Wrap long lines',
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
  }
}
