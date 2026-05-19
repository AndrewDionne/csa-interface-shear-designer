# CSA A23.3 Cold Joint Interface Shear Designer

Static GitHub Pages-ready analysis/design tool for a composite slab-on-beam cold joint interface.

The app provides:

- Single-span simply supported beam analysis
- Two-span continuous beam analysis using a small Euler-Bernoulli beam finite-element solver
- Span + cantilever overhang beam analysis
- Uniform factored load `Wf`
- Optional point load `Pf` at distance `x`
- `Mf`, `Vf`, `VQ/I`, `V/z`, and interface stress diagrams
- Critical station insertion at supports, load points, zero-shear roots, and zone boundaries
- Beam elevation graphic
- Cross-section graphic showing slab placement, roughened interface, stirrups, dowels/hairpins, bottom/top reinforcement, and optional two-row longitudinal bar layouts
- Canadian reinforcing bar lookup
- Vertical beam shear check updated to the provided CSA A23.3:24 shear excerpt, including Clause 11.3.6.3 simplified-method beta logic and Clause 11.3.6.4 general-method beta/theta logic
- Interface shear-transfer check with Clause 11.5 references, expanded interface-condition presets, and separated beam/interface utilization
- Component-based gross section properties with optional flanged/T-section input
- Calculated flexural stress-block lever arm `z` for cracked `V/z` interface demand, including longitudinal bar-row effects on `d`
- Sign-aware flexural reasonableness check using bottom steel for positive moment and top steel for negative moment
- Authoritative shear-zone schedule checks
- Conservative "unused stirrup balance" allocation method:
  - first allocate required stirrup steel to vertical beam shear
  - then count the residual crossing steel toward interface shear
  - then calculate additional developed dowels / hairpins required

## Quick start

Open `index.html` directly in a browser, or host the repo using GitHub Pages.

No build step is required.

## GitHub Pages deployment

1. Create a new GitHub repository.
2. Copy these files into the repository root.
3. Commit and push.
4. In GitHub, go to **Settings → Pages**.
5. Select **Deploy from branch**.
6. Choose `main` and `/root`.
7. Open the generated Pages URL.

## Files

```text
.
├── index.html
├── styles.css
├── app.js
├── docs/
│   ├── methodology.md
│   └── validation.md
├── .nojekyll
├── .gitignore
└── README.md
```

## Design notes

This is a design-aid application, not a substitute for project-specific engineering judgement. Confirm the following before using it in production:

- governing CSA A23.3 edition
- load combinations and whether inputs are factored or service
- support boundary conditions
- point-load position and load path
- interface surface preparation and inspection
- reinforcement development and anchorage across the interface
- bar congestion and constructability
- whether the same reinforcement can reasonably be counted for both vertical shear and interface shear
- minimum shear reinforcement and maximum spacing under the provided CSA A23.3:24 shear excerpt
- flexural adequacy
- deep-beam / D-region behaviour where flagged

## Default example

The default example is aligned with the prior worked calculation:

- `Wf = 544 kN/m`
- `L = 16 m`
- `h = 1800 mm`
- `b = 3000 mm`
- second placement slab depth `= 350 mm`
- `f'c = 50 MPa`
- `fy = 400 MPa`
- bottom steel `28-35M`
- top steel default `0-35M` unless negative-moment checks are needed
- primary stirrups `8 legs 15M @ 450 mm`
- additional interface hairpins `4 legs 15M @ 350 mm`

## Methodology

See [`docs/methodology.md`](docs/methodology.md).


## Patch notes in this version

Implemented engineering and UX hardening items:

- Removed the summed beam-shear + interface-shear utilization pass/fail check. The app now checks vertical beam shear and interface shear separately and reports the governing maximum.
- Made the scheduled zones authoritative for vertical shear strength, spacing, minimum steel, and interface checks.
- Added component-based gross-section properties and an optional flanged/T-section model.
- Added calculated stress-block `z` for cracked force-flow demand, with manual `z/d` still available as an override.
- Added top longitudinal steel inputs and sign-aware flexural reasonableness checks.
- Added a general-method shear option using εx-based β and θ inputs/calculation fields.
- Added critical station insertion at supports, `d`/`dv` offsets, zone boundaries, point-load locations, and zero-shear roots.
- Added a compliance dashboard that distinguishes analysis model review, strength checks, limited detailing checks, and incomplete CSA compliance scope.
- Added a hybrid auto-design strategy: tighten primary stirrups first, then add dowels/hairpins only if required.

Additional changes in this patch:

- Added CSA A23.3:24 clause references in the UI/report for Clauses 11.2.8, 11.3, and 11.5 from the provided excerpt.
- Updated simplified shear beta expressions to distinguish Eq. 11.1 minimum transverse reinforcement cases from no-minimum-transverse-reinforcement cases.
- Updated general-method shear expressions to use Eq. 11.11, Eq. 11.12, and the non-prestressed/no-axial-load form of Eq. 11.13 with `Mf/dv` not less than `Vf`.
- Added automatic `sze` handling for the general method, including `sze = 300 mm` where Eq. 11.1 minimum transverse reinforcement is provided and Eq. 11.10 where it is not.
- Corrected the high-shear spacing threshold to use `0.125 λϕc f′c bw dv`, not `sqrt(f′c)`.
- Added interface presets for monolithic concrete and concrete anchored to as-rolled structural steel from Clause 11.5.2.


Additional elevation/diagram cleanup in v19:

- Increased elevation canvas spacing and text sizes.
- Added a clearer span dimension below the elevation.
- Replaced the visible blue slider thumb/track with an invisible slider; the red dashed station cursor is now the visible slider.
- Reworked design zones as semi-transparent bands with boundary ticks and larger reinforcement labels.
- Changed the interface shear demand diagram to blue and reduced its height to a compact strip.

Still intentionally deferred:

- Full CSA A23.3-24 edition selector and full-standard clause lock-in beyond the uploaded shear excerpt.
- Normal force, inclined interface reinforcement, headed studs, post-installed bar options, and the alternative interface equation.
- Development length, anchorage, splice, congestion, and full detailing compliance.
- Torsion and strut-and-tie modelling.


## v20 update

See `docs/patch_notes_v20.md` for the zone-definition/assignment editor, span + cantilever overhang system, hidden auto-design controls, and elevation utilization band.
### v21 graphics cleanup

- Beam elevation is now placed to the left of a side panel containing the selected-station utilization dashboard and cross-section.
- The selected station dashboard reports `Mf/Mr`, `Vf/Vr`, and `Vinterface/Vr interface`.
- Zone graphics now use thin light-grey stirrup interval lines instead of red/orange shaded zone fills.
- Interface utilization remains based on the scheduled detail at the selected station and does not double-count primary stirrup steel when the balance allocation method is selected.



## v22 calculation/report refinement

- Added bottom and top longitudinal bar row controls with a shared vertical row spacing; selected two-row layouts now reduce the calculated effective depth `d`/`d-` through the longitudinal steel centroid.
- Updated the cross-section graphic to show bottom and top longitudinal steel in the selected number of rows.
- Revised Calculation Set 2 to show the compression-block calculation used to obtain a single reported cracked-force-flow lever arm `z`.
- Revised Calculation Set 8 so the interface steel check is written in the requested sequence: required interface steel, unused stirrup balance, additional dowel requirement, dowel provided, then final required-versus-available result.
