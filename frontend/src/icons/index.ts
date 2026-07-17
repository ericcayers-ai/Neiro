export { Icon, type IconProps } from './Icon'
export {
  IconAbout,
  IconAnalysis,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDismiss,
  IconImport,
  IconJobs,
  IconLearn,
  IconLoop,
  IconMidi,
  IconMute,
  IconPause,
  IconPitchCorrect,
  IconPlay,
  IconPrefs,
  IconRestore,
  IconScrub,
  IconSearch,
  IconSelect,
  IconSeparate,
  IconSolo,
  IconSpectrogram,
  IconSplit,
  IconStop,
  IconStudio,
  IconZoomIn,
  IconZoomOut,
  IconUndo,
  IconRedo,
  IconReset,
  IconPencil,
  IconErase,
} from './set'

import type { ComponentType } from 'react'
import type { ModuleId } from '../api/types'
import type { IconProps } from './Icon'
import {
  IconAbout,
  IconAnalysis,
  IconImport,
  IconLearn,
  IconMidi,
  IconPrefs,
  IconRestore,
  IconSeparate,
  IconStudio,
} from './set'

/** Module rail icons — ink stroke set. */
export const MODULE_ICONS: Record<ModuleId, ComponentType<IconProps>> = {
  import: IconImport,
  analysis: IconAnalysis,
  studio: IconStudio,
  separate: IconSeparate,
  restore: IconRestore,
  midi: IconMidi,
  transcribe: IconMidi,
  learn: IconLearn,
  preferences: IconPrefs,
  about: IconAbout,
  mixer: IconStudio,
}
