import type { ReplayConfig } from './presentation-clock'

export const PRESENTATION_COMMAND_EVENT = 'presentation:command'
export const PRESENTATION_STATUS_EVENT = 'presentation:status'
export const PRESENTATION_STATUS_REQUEST_EVENT = 'presentation:status-request'

export type PresentationCommand =
  | { type: 'start'; config: ReplayConfig }
  | { type: 'toggle' }
  | { type: 'restart' }
  | { type: 'stop' }

export type PresentationStatus = {
  active: boolean
  playing: boolean
  transitioning: boolean
  finished: boolean
  progress: number
  time: string
  message: string
}
