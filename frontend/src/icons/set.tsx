import { Icon, type IconProps } from './Icon'

export function IconImport(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3v10" />
      <path d="M6.5 9.5 10 13l3.5-3.5" />
      <path d="M4 16.5h12" />
    </Icon>
  )
}

export function IconAnalysis(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 15.5V9" />
      <path d="M7.5 15.5V5.5" />
      <path d="M11.5 15.5v-7" />
      <path d="M15.5 15.5V8" />
      <path d="M3 16.5h14" />
    </Icon>
  )
}

export function IconStudio(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5.5" width="15" height="9" rx="1.5" />
      <path d="M5.5 8.5v3" />
      <path d="M8.5 7.5v5" />
      <path d="M11.5 9v2" />
      <path d="M14.5 8v4" />
    </Icon>
  )
}

export function IconSeparate(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="7" r="2.25" />
      <circle cx="14" cy="7" r="2.25" />
      <circle cx="10" cy="14" r="2.25" />
      <path d="M7.7 8.5 8.9 12" />
      <path d="M12.3 8.5 11.1 12" />
    </Icon>
  )
}

export function IconRestore(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M4.5 4.5v3.5H8" />
    </Icon>
  )
}

export function IconMidi(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <path d="M6 4.5v11" />
      <path d="M10 4.5v11" />
      <path d="M14 4.5v11" />
      <path d="M3 11.5h14" />
    </Icon>
  )
}

export function IconLearn(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7.5 10 4.5l6.5 3-6.5 3-6.5-3z" />
      <path d="M6.5 9.2v3.3c0 1.2 1.6 2.5 3.5 2.5s3.5-1.3 3.5-2.5V9.2" />
      <path d="M16.5 7.5v5" />
    </Icon>
  )
}

export function IconPrefs(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="2.25" />
      <path d="M10 3.5v2.2M10 14.3v2.2M3.5 10h2.2M14.3 10h2.2M5.4 5.4l1.55 1.55M13.05 13.05l1.55 1.55M14.6 5.4l-1.55 1.55M6.95 13.05 5.4 14.6" />
    </Icon>
  )
}

export function IconAbout(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5" />
      <path d="M10 6.5h.01" />
    </Icon>
  )
}

export function IconJobs(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5h12" />
      <path d="M4 10h12" />
      <path d="M4 13.5h8" />
      <path d="M14.5 12.5 16.5 14.5 14.5 16.5" />
    </Icon>
  )
}

export function IconPlay(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.5v11l9-5.5-9-5.5z" />
    </Icon>
  )
}

export function IconPause(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.5h2.5v11H7z" />
      <path d="M12.5 4.5H15v11h-2.5z" />
    </Icon>
  )
}

export function IconStop(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
    </Icon>
  )
}

export function IconLoop(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 9a5.5 5.5 0 0 1 9.2-3.9L15.5 7" />
      <path d="M15.5 3.5V7h-3.5" />
      <path d="M15.5 11a5.5 5.5 0 0 1-9.2 3.9L4.5 13" />
      <path d="M4.5 16.5V13H8" />
    </Icon>
  )
}

export function IconZoomIn(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="8.5" r="4.5" />
      <path d="M12 12l4 4" />
      <path d="M8.5 6.5v4" />
      <path d="M6.5 8.5h4" />
    </Icon>
  )
}

export function IconZoomOut(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="8.5" r="4.5" />
      <path d="M12 12l4 4" />
      <path d="M6.5 8.5h4" />
    </Icon>
  )
}

export function IconMute(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5h2.5L10 5v10L6 11.5H3.5z" />
      <path d="M13 8l4 4M17 8l-4 4" />
    </Icon>
  )
}

export function IconSolo(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5v7" />
      <path d="M7.5 10h5" />
    </Icon>
  )
}

export function IconScrub(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10h13" />
      <path d="M10 4.5v11" />
      <circle cx="10" cy="10" r="2" />
    </Icon>
  )
}

export function IconSplit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3.5v13" />
      <path d="M4.5 7.5 10 10l5.5-2.5" />
      <path d="M4.5 12.5 10 10l5.5 2.5" />
    </Icon>
  )
}

export function IconSelect(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5 5 14.5 8.2 11.8 10.2 16.2 12 15.4 10 11 14.5 11z" />
    </Icon>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="8.5" r="4.5" />
      <path d="M12 12l4.5 4.5" />
    </Icon>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5 6.5 10 12 15.5" />
    </Icon>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 4.5 13.5 10 8 15.5" />
    </Icon>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7.5 10 13l5.5-5.5" />
    </Icon>
  )
}

export function IconChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12.5 10 7l5.5 5.5" />
    </Icon>
  )
}

export function IconDismiss(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 5.5 14.5 14.5" />
      <path d="M14.5 5.5 5.5 14.5" />
    </Icon>
  )
}

export function IconSpectrogram(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 14.5V9.5" />
      <path d="M7 14.5V5.5" />
      <path d="M10.5 14.5V8" />
      <path d="M14 14.5V4.5" />
      <path d="M17.5 14.5V10" />
    </Icon>
  )
}

export function IconPitchCorrect(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 13.5c1.2-3.5 3.2-5.5 5-5.5s3.8 2 5 5.5" />
      <path d="M10 4.5v4" />
      <path d="M8 6.5h4" />
      <circle cx="15.5" cy="14" r="1.5" />
    </Icon>
  )
}

export function IconUndo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 8.5h6.5a4 4 0 1 1 0 8H8" />
      <path d="M8 5.5 5 8.5l3 3" />
    </Icon>
  )
}

export function IconRedo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 8.5H8.5a4 4 0 1 0 0 8H12" />
      <path d="M12 5.5 15 8.5l-3 3" />
    </Icon>
  )
}

export function IconReset(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 10a5.5 5.5 0 1 0 1.5-3.8" />
      <path d="M4.5 4v3.5H8" />
      <path d="M10 7.5v5" />
      <path d="M8.5 10h3" />
    </Icon>
  )
}

export function IconPencil(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.5 4.5 15.5 7.5 8 15H5v-3z" />
      <path d="M11 6 14 9" />
    </Icon>
  )
}

export function IconErase(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 10.5 7l3.5 3.5L8.5 16H5z" />
      <path d="M4 16.5h12" />
    </Icon>
  )
}
