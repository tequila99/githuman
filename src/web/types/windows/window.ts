import type { Component } from 'vue'

import type { DOCK_EDGES } from '@/constants/windows/constants'

export interface WindowState {
  position: WindowPoint
  windowSize: WindowSize | null
  open: boolean
  minimized: boolean
  maximized: boolean
}
export type DockEdge = (typeof DOCK_EDGES)[number]
export interface DockState {
  edge: DockEdge
  position: WindowPoint | null
}
export interface WindowApplication {
  id: string
  component?: Component
  title: () => string
  icon: string
  availability: () => { enabled: boolean; reason?: string }
  badge: () => number | null
  active: () => boolean
  activate: () => void | Promise<void>
  persistence?: ApplicationPersistence
}

export interface ApplicationPersistence {
  version: number
  serialize: () => unknown
  restore: (saved: unknown, version: number) => void
}

export interface WindowSize {
  width: number
  height: number
}
export interface WindowPoint {
  x: number
  y: number
}
export type WindowRect = WindowPoint & WindowSize
export type ResizeEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
