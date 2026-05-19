# Patch notes v20 — zone editor and elevation utilization cleanup

## Scope

This patch focuses on the reinforcement-zone UX and the beam elevation workflow.

## Changes

- Split the zone workflow into two separate concepts:
  - **Zone definitions**: reusable reinforcement recipes.
  - **Zone assignments**: one or more x-ranges where a definition applies.
- Added support for assigning the same zone definition to multiple non-contiguous locations.
- Kept Zone 1 as the full-beam fallback definition and full-beam base assignment.
- Updated the former cantilever system to **span + cantilever overhang**:
  - `L1` is the supported span.
  - `L2` is the cantilever/overhang length beyond the right support.
  - Supports are placed at `x = 0` and `x = L1`; the beam continues to `x = L1 + L2`.
- Hid shear-zone design options behind the **Auto design** button.
- Renamed the auto-design action to **Design shear zones**.
- Added a scheduled utilization band to the elevation view:
  - Green: utilization below 0.85.
  - Amber: utilization between 0.85 and 1.0.
  - Red: utilization above 1.0 or failed local check.
- Updated the elevation scrubber readout to show station and scheduled utilization.
- Updated the cross-section title to show the active scheduled zone and local utilization.

## Validation

- `node --check app.js` passed.
- A lightweight DOM-mock smoke test confirmed that the app initializes, renders the zone editor, renders the elevation utilization band, and produces summary/status output.

## Notes

- Later assignments override earlier assignments where ranges overlap.
- The scheduled utilization band uses the current scheduled reinforcement, not just the base input reinforcement.
