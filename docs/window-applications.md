# Window applications

The window panel uses a public TypeScript API for trusted modules in this application. It does not load external code.

Register an application through `useApplicationRegistry()` after Pinia is available. The panel reads its title, availability, badge and active state through reactive callbacks. `activate()` opens the application or restores its existing window. It can return a Promise; the panel prevents concurrent activation and displays errors.

```ts
import { useApplicationRegistry } from '@/stores/windows/application-registry'
import { useWindowStore } from '@/stores/windows/window-store'
import ClockWindow from './ClockWindow.vue'

const windows = useWindowStore()
const unregister = useApplicationRegistry().register({
  id: 'clock',
  component: ClockWindow,
  title: () => 'Clock',
  icon: 'schedule',
  availability: () => ({ enabled: true }),
  badge: () => null,
  active: () => windows.isActive('clock'),
  activate: () => windows.focus('clock')
})
```

`WindowHost` mounts registered components. The component uses `FloatingWindow` with a stable `windowId`, title, header slot and content slot. `useWindowGeometry(windowId)` supplies drag and resize behavior. `useWindowStore().ensure(windowId)` supplies the window state. Save changes with `remember()` after a resize or mode change. `FloatingWindow` accepts an optional `minimum` size for its resize handles.

An application can manage several windows with different IDs. Its own callbacks define the badge and activation policy. A dock-only widget can omit `component` and show a compact panel through its activation action. No changes to `WindowDock` or `window-store` are required.

Call the returned `unregister()` function when the module is removed. It removes the panel entry and its component and stops its persistence watcher. Close the application's windows before removal if their state must no longer be active.

## Application state

An optional `persistence` adapter has `version`, `serialize()` and `restore(saved, version)`. The registry stores its JSON data through `safeStorage`. The adapter must validate unknown data and migrate or reject older versions. Keep documents, rendered HTML, SVG, image bytes, functions and components out of saved state. Save source locators and view preferences instead.

Window geometry and panel preferences use a separate versioned store. Invalid preferences and unavailable browser storage do not prevent normal use. Browser origins separate instances on different ports.

## Built-in applications

Terminal sessions remain in `terminal-store`; the shared window store manages their window geometry. Reload reconnects to live server sessions. A server restart does not restart lost shell commands.

Preview tabs store file refs or chat/message locators. MD, Mermaid and image tabs share one window. Inactive tabs load or refresh when activated. Missing sources retain their tabs with an explanation. Diagram matching uses a content fingerprint, then its previous position; changing both order and content can select a different diagram at that position.

The file API accepts `strict=true` for previews. It returns 404 for missing files and keeps empty files distinct. Reads without this option keep the previous empty-content behavior used by diff views.

## Module layout

Window modules are grouped by responsibility: `constants/windows`, `types/windows`, `stores/windows`, `composables/windows`, and `utils/windows`. The shared shell components live in `components/windows`. Terminal transport remains in `stores/terminal-store`; terminal and preview components retain their own directories. Tests mirror the source directories.

## Local files and PDF

The empty preview offers Open file; the header retains the action when tabs are open. The picker and file drop accept Markdown, browser-supported images and PDF. Every local file opens an active tab. Local File objects remain in browser memory, are never uploaded and are not saved in preferences. Reopen local files after a page reload. Image Blob URLs are revoked when their last tab closes.

PDF.js and its worker load only when a PDF tab is visible. One canvas renders the selected page; its bitmap is capped at four million pixels (about 16 MiB). This cap applies to the bitmap, not total document memory. Fonts, CMaps and image decoders are served locally on demand. Page changes cancel earlier renders and clean the previous page. Switching tabs, minimizing or closing destroys the PDF document and worker. Returning restores the selected page and scale. This viewer provides page navigation and zoom; text selection, forms and annotations are outside this implementation.
