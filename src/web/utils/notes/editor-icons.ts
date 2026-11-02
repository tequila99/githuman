import {
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiChevronDown,
  mdiClose,
  mdiCodeBraces,
  mdiCodeTags,
  mdiDragHorizontal,
  mdiDragVertical,
  mdiEyeOutline,
  mdiFormatAlignCenter,
  mdiFormatAlignLeft,
  mdiFormatAlignRight,
  mdiFormatBold,
  mdiFormatHeader1,
  mdiFormatHeader2,
  mdiFormatHeader3,
  mdiFormatHeader4,
  mdiFormatHeader5,
  mdiFormatHeader6,
  mdiFormatItalic,
  mdiFormatListBulleted,
  mdiFormatListChecks,
  mdiFormatListNumbered,
  mdiFormatQuoteClose,
  mdiFormatStrikethrough,
  mdiFormatText,
  mdiFunctionVariant,
  mdiImageOutline,
  mdiLinkVariant,
  mdiMagnify,
  mdiMinus,
  mdiPencilOutline,
  mdiPlus,
  mdiTable,
  mdiTableColumnPlusAfter,
  mdiTableColumnRemove,
  mdiTableRowPlusAfter,
  mdiTableRowRemove,
  mdiTrashCanOutline
} from '@mdi/js'
import { Crepe } from '@milkdown/crepe'
import type { CrepeConfig } from '@milkdown/crepe'
import { APP_ICONS } from '@/constants/icons'

// The editor's supported configuration keeps its icons aligned with the application.
export const EDITOR_ICON_CONFIG: NonNullable<CrepeConfig['featureConfigs']> = {
  [Crepe.Feature.Toolbar]: {
    boldIcon: svg(mdiFormatBold),
    italicIcon: svg(mdiFormatItalic),
    strikethroughIcon: svg(mdiFormatStrikethrough),
    codeIcon: svg(mdiCodeTags),
    linkIcon: svg(mdiLinkVariant),
    latexIcon: svg(mdiFunctionVariant),
    aiIcon: svg(APP_ICONS.agent)
  },
  [Crepe.Feature.TopBar]: {
    boldIcon: svg(mdiFormatBold),
    italicIcon: svg(mdiFormatItalic),
    strikethroughIcon: svg(mdiFormatStrikethrough),
    codeIcon: svg(mdiCodeTags),
    linkIcon: svg(mdiLinkVariant),
    imageIcon: svg(mdiImageOutline),
    tableIcon: svg(mdiTable),
    codeBlockIcon: svg(mdiCodeBraces),
    mathIcon: svg(mdiFunctionVariant),
    quoteIcon: svg(mdiFormatQuoteClose),
    hrIcon: svg(mdiMinus),
    bulletListIcon: svg(mdiFormatListBulleted),
    orderedListIcon: svg(mdiFormatListNumbered),
    taskListIcon: svg(mdiFormatListChecks),
    chevronDownIcon: svg(mdiChevronDown)
  },
  [Crepe.Feature.BlockEdit]: {
    handleAddIcon: svg(mdiPlus),
    handleDragIcon: svg(mdiDragVertical),
    textGroup: {
      text: { icon: svg(mdiFormatText) },
      h1: { icon: svg(mdiFormatHeader1) },
      h2: { icon: svg(mdiFormatHeader2) },
      h3: { icon: svg(mdiFormatHeader3) },
      h4: { icon: svg(mdiFormatHeader4) },
      h5: { icon: svg(mdiFormatHeader5) },
      h6: { icon: svg(mdiFormatHeader6) },
      quote: { icon: svg(mdiFormatQuoteClose) },
      divider: { icon: svg(mdiMinus) }
    },
    listGroup: {
      bulletList: { icon: svg(mdiFormatListBulleted) },
      orderedList: { icon: svg(mdiFormatListNumbered) },
      taskList: { icon: svg(mdiFormatListChecks) }
    },
    advancedGroup: {
      image: { icon: svg(mdiImageOutline) },
      codeBlock: { icon: svg(mdiCodeBraces) },
      table: { icon: svg(mdiTable) },
      math: { icon: svg(mdiFunctionVariant) }
    }
  },
  [Crepe.Feature.LinkTooltip]: {
    linkIcon: svg(mdiLinkVariant),
    editButton: svg(mdiPencilOutline),
    removeButton: svg(mdiTrashCanOutline),
    confirmButton: svg(APP_ICONS.done)
  },
  [Crepe.Feature.ListItem]: {
    checkBoxCheckedIcon: svg(mdiCheckboxMarked),
    checkBoxUncheckedIcon: svg(mdiCheckboxBlankOutline)
  },
  [Crepe.Feature.CodeMirror]: {
    expandIcon: svg(mdiChevronDown),
    searchIcon: svg(mdiMagnify),
    clearSearchIcon: svg(mdiClose),
    copyIcon: svg(APP_ICONS.copy),
    previewToggleIcon: previewOnly =>
      svg(previewOnly ? mdiCodeTags : mdiEyeOutline)
  },
  [Crepe.Feature.Table]: {
    addRowIcon: svg(mdiTableRowPlusAfter),
    addColIcon: svg(mdiTableColumnPlusAfter),
    deleteRowIcon: svg(mdiTableRowRemove),
    deleteColIcon: svg(mdiTableColumnRemove),
    alignLeftIcon: svg(mdiFormatAlignLeft),
    alignCenterIcon: svg(mdiFormatAlignCenter),
    alignRightIcon: svg(mdiFormatAlignRight),
    colDragHandleIcon: svg(mdiDragHorizontal),
    rowDragHandleIcon: svg(mdiDragVertical)
  }
}

// Crepe expects SVG markup rather than Quasar paths; every path here is a static import.
function svg(path: string): string {
  return `<svg class="app-editor-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`
}
