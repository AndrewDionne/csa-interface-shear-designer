# Patch notes v21 — graphics layout, utilization dashboard, and stirrup-interval zones

## Purpose

This patch cleans up the beam graphical interface after the zone-assignment work in v20. The goal is to make the elevation read more like an engineering drawing while keeping the section and local utilization visible during station scrubbing.

## Changes

- Reworked the graphical results panel into a two-column layout:
  - beam elevation on the left;
  - station utilization dashboard and cross-section on the right.
- Replaced the long coloured utilization band with a compact station utilization dashboard.
- The station dashboard updates with the red dashed station cursor and reports:
  - `Mf / Mr`;
  - `Vf / Vr`;
  - `Vinterface / Vr interface`.
- The interface utilization continues to use the scheduled detail at the selected station and the selected steel-allocation rule. Under the balance allocation, only the unused stirrup balance plus dowels are credited to interface shear resistance, preventing double-counting of stirrup steel.
- Replaced red/orange shaded zone blocks on the elevation with thin light-grey stirrup interval lines for the active zone reinforcement spacing.
- Kept neutral zone boundary ticks and labels so repeated assignments of the same zone remain visible without heavy colour fills.
- Kept the red dashed station cursor as the slider visual; the hidden range input still provides the scrub interaction.
- Reduced the elevation SVG height now that utilization is shown in the side dashboard.

## Validation

- `node --check app.js` passed.
- Lightweight DOM smoke test confirmed:
  - app initialization;
  - elevation rendering with interval-zone graphics;
  - station utilization dashboard rendering;
  - zone editor rendering;
  - status output rendering.
- Zip integrity check passed.
