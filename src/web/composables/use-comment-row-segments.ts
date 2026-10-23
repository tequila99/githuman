import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Comment } from '@/api/types'
import { groupRows, rowSegmentProps } from '@/utils/row-segments'

export function useCommentRowSegments<
  T extends { comments: Comment[] }
>(options: {
  rows: MaybeRefOrGetter<T[]>
  owner: MaybeRefOrGetter<object>
  wrap: MaybeRefOrGetter<boolean | undefined>
  commentsEditable: MaybeRefOrGetter<boolean | undefined>
  threshold?: MaybeRefOrGetter<number | undefined>
  rowHeight?: MaybeRefOrGetter<number | undefined>
  hasForm: (row: T) => boolean
}) {
  const grouping = computed(() =>
    groupRows(toValue(options.rows), toValue(options.threshold))
  )
  const segmentOptions = computed(() => ({
    comments: (row: T) => row.comments,
    hasForm: options.hasForm,
    owner: toValue(options.owner),
    wrap: Boolean(toValue(options.wrap)),
    commentsEditable: Boolean(toValue(options.commentsEditable)),
    rowHeight: toValue(options.rowHeight)
  }))
  const segments = computed(() =>
    grouping.value.groups.map(group => ({
      ...group,
      props: rowSegmentProps(group, segmentOptions.value)
    }))
  )
  return { grouping, segments }
}
