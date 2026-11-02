import { defineBoot } from '#q-app'
import mdi from 'quasar/icon-set/svg-mdi-v7'
import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiCloseCircleOutline,
  mdiInformationOutline,
  mdiPencilOutline
} from '@mdi/js'

export default defineBoot(({ app }) => {
  // Form markers retain their filled states; only decorative shapes change.
  app.config.globalProperties.$q.iconSet.set({
    ...mdi,
    type: {
      ...mdi.type,
      positive: mdiCheckCircleOutline,
      negative: mdiAlertCircleOutline,
      info: mdiInformationOutline,
      warning: mdiAlertOutline
    },
    chip: { ...mdi.chip, remove: mdiCloseCircleOutline },
    field: {
      ...mdi.field,
      clear: mdiCloseCircleOutline,
      error: mdiAlertCircleOutline
    },
    stepper: {
      ...mdi.stepper,
      active: mdiPencilOutline,
      error: mdiAlertOutline
    },
    table: { ...mdi.table, warning: mdiAlertOutline },
    tree: { icon: mdiChevronRight }
  })
})
