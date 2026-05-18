# CSA A23.3 Cold Joint Interface Shear Designer

Static GitHub Pages-ready analysis/design tool for a composite slab-on-beam cold joint interface.

The app provides:

- Single-span simply supported beam analysis
- Two-span continuous beam analysis using a small Euler-Bernoulli beam finite-element solver
- Cantilever beam analysis
- Uniform factored load `Wf`
- Optional point load `Pf` at distance `x`
- `Mf`, `Vf`, `VQ/I`, and interface stress diagrams
- Beam elevation graphic
- Cross-section graphic showing slab placement, roughened interface, stirrups, dowels/hairpins, and bottom reinforcement
- Canadian reinforcing bar lookup
- Vertical beam shear check
- Interface shear-transfer check
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
- minimum and maximum shear reinforcement spacing
- flexural adequacy

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
- primary stirrups `8 legs 15M @ 450 mm`
- additional interface hairpins `4 legs 15M @ 350 mm`

## Methodology

See [`docs/methodology.md`](docs/methodology.md).
