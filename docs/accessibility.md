# Accessibility baseline

This is a **baseline and a test plan**, not a WCAG certification. No axe run,
screen-reader walkthrough or keyboard-only matrix has been completed; the
traceability row that claims otherwise is over-stated and the audit says so.

## What exists

- Skip link and landmark regions; rail navigation with `aria-current`, labels and
  hints.
- Command palette with focus handling and Escape dismissal.
- `aria-live` regions for job progress, session messages and practice feedback.
- Labelled form controls, `aria-valuetext` on the player's sliders, table captions
  and `scope` attributes in the analysis report.
- Reduced-motion and high-contrast preferences in the theme system.
- Player: every control is a native button/input; A–B, markers and clips are
  keyboard reachable; Space/Enter resumes a wait gate; the method/latency line is a
  polite live region.

## New player/library keys

| Key | Action |
|---|---|
| `Space` / `Enter` | play/pause, or resume a wait gate |
| `Tab` / `Shift+Tab` | move through transport, controls, markers, clips |
| `0` | Library module (rail) |
| `1`–`6`, `9` | existing module shortcuts |

Focus is not trapped in the player (it is inline content, not a modal). The session
dialog and command palette do trap focus and close on Escape.

## Known gaps

- No automated axe/WCAG run in CI.
- Chord/beat lanes are `role="img"` with a text summary; a screen reader gets the
  segment list only through the accessible name, not per-segment navigation.
- The addon panel is keyboard reachable but has not been tested with a screen
  reader.
- RTL layout and pluralisation are not exercised (English-only catalogue today).
- Colour contrast of the new lane colours should be checked against both themes.

## How to verify (owner-run)

1. Keyboard-only pass: import → play → transpose → set A/B → loop → add marker →
   play clip → open Library → save notes, without a mouse.
2. Screen reader (NVDA on Windows): traverse the rail, player controls, the analysis
   lanes, and a job progress region.
3. axe DevTools on Import, Analysis, Practice and Library; record violations.
4. Reduced motion + high contrast themes: confirm the player and lanes remain
   legible and no essential motion is lost.

Record the results in `docs/evidence/` before claiming an accessibility audit.
