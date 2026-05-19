# Patch notes — v17 engineering hardening

Implemented scope requested from the audit priorities:

## Calculation / engineering changes

1. **Separated utilization checks**
   - Removed the previous pass/fail logic that summed beam-shear utilization and interface-shear utilization.
   - The app now checks vertical beam shear and interface shear separately.
   - The displayed shear utilization is the governing maximum of the two separate ratios.

2. **Component-based section properties**
   - Replaced the hardcoded rectangular-only gross-section property calculation with a component-based property engine.
   - Default remains rectangular.
   - Added optional flanged/T-section gross property model.
   - `I_g`, gross neutral axis, area above the interface, and `Q` are now calculated from components.

3. **Calculated `z` for cracked force-flow demand**
   - Added automatic `z` calculation from the flexural compression block.
   - Kept manual `z/d` as an override.
   - Added report text clarifying that `z` is related to the cracked/stress-block calculation but is not the same as neutral-axis depth.

4. **Sign-aware flexural reasonableness check**
   - Added top longitudinal steel inputs.
   - Positive moment uses bottom steel.
   - Negative moment uses top steel.
   - Flexural check remains a reasonableness check, not a complete flexural design module.

5. **General shear method option**
   - Added a general-method option using εx-based β and θ calculations.
   - Added inputs for `E_s` and equivalent crack spacing `s_ze`.
   - Simplified β = 0.18, θ = 35° remains available.

6. **Authoritative zone schedule**
   - Zone schedule is now the controlling design check for vertical shear, spacing, minimum shear steel, interface shear, and practical spacing.
   - Zone 1 is the default full-span zone; added zones override over specified ranges.

7. **Critical station generation**
   - Added stations at support locations, point loads, zone boundaries, `d`/`d_v` offsets, and detected zero-shear roots.
   - This reduces the risk of missing local maxima or narrow user zones.

8. **Interface resistance refactor**
   - Interface required steel and interface resistance are now separated into helper functions.
   - The balance allocation method still avoids double-counting stirrups: beam-shear demand consumes primary stirrup steel first, and only the unused balance is credited to interface shear.

9. **Auto-design strategy fix**
   - Added `hybrid` strategy: tighten primary stirrups first, then add dowels/hairpins only if needed.
   - `primaryOnly` no longer silently behaves as the same thing as add-dowel strategies.

## UI / UX changes

1. **Compliance dashboard**
   - Added top-level dashboard for:
     - Analysis model
     - Strength checks
     - Limited detailing checks
     - CSA compliance status

2. **Design checks clarified**
   - The check cards now show separated vertical beam shear and interface shear utilization.
   - No summed beam/interface interaction is presented as a code equation.

3. **Zone schedule clarified**
   - Added governing reason column.
   - Shows beam/interface utilization separately.

4. **Inputs clarified**
   - Added section model inputs.
   - Added top steel inputs.
   - Added automatic/manual `z` option.
   - Added general shear-method inputs.

## Still deferred

- CSA A23.3-24 edition selector and clause-specific implementation.
- Normal force and inclined interface reinforcement options.
- Development length, anchorage, splice, post-installed bar, and full detailing review.
- Torsion.
- Full strut-and-tie/deep-beam design; current implementation flags only.
