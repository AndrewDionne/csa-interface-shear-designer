# Patch notes v19 — elevation view cleanup

This patch is a UI/UX cleanup pass on the beam elevation and aligned demand diagrams.

## Elevation view

- Increased the drawing canvas height so the beam elevation, span dimension, zone schedule, and demand diagrams have more vertical separation.
- Moved the beam downward to create clearer space between the title, distributed load label, load arrows, and the beam graphic.
- Added a clearer span dimension directly below the support/elevation graphic.
- Increased the elevation title, load labels, interface label, zone labels, and demand-diagram text sizes.

## Station slider

- Removed the visible native blue range-slider track/thumb.
- Kept the slider interaction using an invisible range input over the elevation panel.
- The red dashed station line now acts as the visible slider/cursor.

## Design zones

- Replaced the thin zone line with semi-transparent zone bands.
- Added vertical boundary ticks at zone start/end points.
- Added larger reinforcement labels inside each zone band.
- Added a second label line for added dowels/hairpins where applicable.

## Demand diagrams

- Spread the moment, shear, and interface-demand diagrams farther apart.
- Changed the interface shear demand diagram from orange/brown to the same blue shade family as the other demand graphics.
- Reduced the interface shear demand diagram height to approximately half of the previous height so it reads as a compact demand strip rather than a third full-depth force diagram.
