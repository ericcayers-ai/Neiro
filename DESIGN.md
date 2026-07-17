# Neiro UI design

## Direction
Industrial / utilitarian product UI: ink-on-slate, one accent, calm density. Design serves the task — the tool should disappear into the audio workflow.

## Foundations
- **Type:** IBM Plex Sans + IBM Plex Mono (tabular figures for values/timecodes)
- **Color:** dark-first elevations `--bg0`–`--bg3`, single accent `--accent` / `--accent-hot`, Okabe–Ito stem colors
- **Space:** 4pt scale `--space-1` … `--space-12`
- **Motion:** 120–240ms ease-out; honor `prefers-reduced-motion` and Preferences override
- **Radius:** 4–6px — never pill cards

## Patterns
- Module header: title + one-line lede + primary actions
- Empty gate: titled status + CTA to Import
- Advanced options behind `<details class="advanced-block">`
- Command palette (Ctrl/⌘K) for module jump
- Collapsible rail (Ctrl/⌘B); horizontal scroll nav under ~860px
- Session actions in a menu; Save/Open use dialogs

## Accessibility
Skip link, `aria-current` on rail, labeled fields, live regions for job/engine status, focus rings via `--focus`, touch targets ≥2.25rem on primary controls.
