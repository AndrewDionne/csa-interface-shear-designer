# Patch notes v18 - CSA A23.3:24 shear excerpt update

This patch updates the v17 hardened app using the provided CSA A23.3:24 shear provisions excerpt.

## Implemented

- Added report/UI clause references for:
  - Clause 11.2.8 minimum shear reinforcement
  - Clause 11.3 flexural-region shear design
  - Clause 11.5 interface shear transfer
- Updated vertical shear resistance to report:
  - `Vr >= Vf` from Eq. 11.3
  - `Vr = Vc + Vs + Vp` with `Vp = 0` in this app
  - `Vr,max = 0.25 phi_c f'c bw dv` from Eq. 11.5
  - `Vc = phi_c lambda beta sqrt(f'c) bw dv` from Eq. 11.6, with `sqrt(f'c)` capped at 8 MPa
  - `Vs = phi_s Av fyt dv cot(theta) / s` from Eq. 11.7
- Updated simplified-method beta logic:
  - Eq. 11.1 minimum transverse reinforcement provided: beta = 0.18 for fy <= 400 MPa, otherwise beta = 0.4/(1 + fy/320)
  - minimum transverse reinforcement not provided: Eq. 11.9a / 11.9b style beta expressions
- Updated general-method beta/theta logic:
  - Eq. 11.11 for beta
  - Eq. 11.12 for theta
  - Eq. 11.13 adapted for the current no-prestress/no-axial-load app, using max(Mf/dv, Vf) per the excerpt condition
  - epsilon_x capped at 0.003
- Added automatic equivalent crack spacing handling:
  - `sze = 300 mm` where Eq. 11.1 minimum transverse reinforcement is provided
  - Eq. 11.10 when minimum transverse reinforcement is not provided
  - aggregate-size reduction above 60 MPa for Eq. 11.10
- Corrected Clause 11.3.8 high-shear spacing threshold to use `f'c`, not `sqrt(f'c)`.
- Updated minimum shear reinforcement applicability to recognize Clause 11.2.8.1 triggers.
- Added Clause 11.5.2 interface presets:
  - clean not intentionally roughened
  - clean intentionally roughened to at least 5 mm
  - monolithic concrete
  - concrete anchored to as-rolled structural steel
- Updated the interface shear report to show Eq. 11.25, Eq. 11.27, and Eq. 11.28, while documenting the current app assumptions of alpha_f = 90 degrees and N/Ag = 0.

## Still not implemented

- Clause 11.5.6 anchorage/development checks.
- Normal force across the interface.
- Inclined shear-friction reinforcement.
- Alternative interface shear expression from Eq. 11.26.
- Torsion checks.
- Full CSA A23.3:24 standard implementation outside the supplied shear excerpt.
