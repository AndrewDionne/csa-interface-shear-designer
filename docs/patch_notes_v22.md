# Patch notes v22 — longitudinal bar rows + report cleanup

## Section and materials

- Added bottom longitudinal bar row control: 1 row / 2 rows.
- Added top longitudinal bar row control: 1 row / 2 rows.
- Added vertical spacing between longitudinal bar rows.
- Updated effective-depth calculation so two-row bottom reinforcement moves the steel centroid inward and reduces `d`.
- Updated negative-moment effective depth `d-` similarly for top reinforcement rows.
- Updated the cross-section graphic to draw bottom and top longitudinal bars according to the selected row layout.

## Calculation Set 2

- Revised the section-geometry calculation to include the longitudinal bar-row centroid calculation.
- Added the compression-block calculation used to obtain the cracked-force-flow lever arm `z`.
- Report now shows a single reported `z`, rather than listing multiple z options.
- Removed the explanatory note at the bottom of Calculation Set 2.

## Calculation Set 8

- Reordered the interface steel balance to follow the intended engineering sequence:
  1. required interface shear reinforcement,
  2. provided primary stirrup crossing steel,
  3. portion of stirrups required for vertical beam shear,
  4. unused stirrup balance,
  5. additional interface steel required,
  6. provided dowel/hairpin steel,
  7. final required-versus-available result.
- Final line now explicitly reports whether `(Av/s)_interface req <= (Av/s)_unused + (Av/s)_dowel` or whether the requirement exceeds the available interface steel.

## QA

- `node --check app.js` passed.
- Zip integrity check passed.
- Full headless browser smoke test was not completed in this environment because local browser navigation was blocked by the container security policy.
