# Methodology

This document summarizes the calculation logic used by the app. It intentionally does not reproduce CSA standard text. This version has been updated against the provided CSA A23.3:24 shear excerpt for Clauses 11.2.8, 11.3, and 11.5. Verify applicability limits, detailing, anchorage, and the full governing project edition of CSA A23.3 before using results for sealed design.

## 1. Beam analysis

The app uses a small Euler-Bernoulli beam finite-element model with vertical translation and rotation degrees of freedom at each node. Supported systems are:

- single-span simply supported
- two-span continuous with simple vertical supports at left, middle, and right
- span + cantilever overhang: supports at the left end and at `L1`, with a free overhang of length `L2`
- uniform factored load over the full length
- one optional point load at a user-selected distance from the left end

The FE model is used to calculate reactions. Demand diagrams are then assembled from statics:

\[
V(x) = \sum R_i - w x - \sum P_i
\]

\[
M(x) = \sum R_i(x-x_i) - \frac{w x^2}{2} - \sum P_i(x-x_i) + \sum M_{support}
\]

Critical stations include the base analysis grid, support locations, point-load locations, zone boundaries, offsets of approximately `d` and `dv` from supports/point loads, and zero-shear roots where detected. This is intended to reduce missed local maxima in moment, shear, and scheduled-zone checks.

## 2. Gross-section properties

The section property engine is component-based. The default rectangular section is one component. The optional flanged/T-section model uses a full-depth web component plus a top-flange overhang component.

Gross area, centroid, and inertia are calculated from components:

\[
\bar y = \frac{\sum A_i y_i}{\sum A_i}
\]

\[
I_g = \sum (I_i + A_i\Delta y_i^2)
\]

For the elastic interface check, the app clips all components above the cold-joint elevation and calculates:

\[
Q = A_{above}(\bar y - y_{above})
\]

This assumes the same concrete modulus above and below the joint. Transformed-section and cracked-section elastic properties are not yet implemented.

## 3. Horizontal interface shear demand

Elastic shear flow:

\[
q = \frac{VQ}{I_g}
\]

Interface stress:

\[
v = \frac{q}{b_i}
\]

The app also includes a cracked force-flow approximation:

\[
q \approx \frac{V}{z}
\]

The user can design for:

- elastic `VQ/I`
- cracked `V/z`
- envelope max of both

### z calculation

The app calculates `z` from the flexural stress block for the cracked `V/z` demand calculation. For a flexural stress-block check:

\[
z = d - y_C
\]

where `y_C` is the distance from the compression face to the compression resultant. This is related to the cracked neutral-axis calculation, but it is not the same value as the neutral-axis depth. The app calculates compression-block depth/centroid, then uses the distance from tension steel to compression resultant as `z`.

If top steel is defined and negative bending exists, the app calculates a negative-moment `z` as well. The governing cracked force-flow demand uses the station moment sign where possible, with the schedule/report also showing the conservative governing `z`.

## 4. Vertical beam shear

The app supports two CSA A23.3:24 shear-method settings for flexural regions. Prestress contribution `Vp`, torsion, axial load, and inclined transverse reinforcement are not included in the current workflow.

Design requirement:

\[
V_r \ge V_f
\]

Factored shear resistance:

\[
V_r = V_c + V_s + V_p
\]

with `Vp = 0` in this app, and:

\[
V_{r,max} = 0.25\phi_c f'_c b_w d_v + V_p
\]

Concrete contribution:

\[
V_c = \phi_c\lambda\beta\sqrt{f'_c}b_wd_v
\]

For `Vc`, the app caps \(\sqrt{f'_c}\) at 8 MPa, matching Clause 11.3.4.

For transverse reinforcement perpendicular to the member axis:

\[
V_s = \phi_s\frac{A_v f_{yt} d_v\cot\theta}{s}
\]

The effective depth `d` is calculated to the centroid of the selected bottom longitudinal bar layout. When two bottom rows are selected, the centroid is shifted inward by one-half of the specified row spacing, reducing `d`. The effective shear depth is calculated as:

\[
d_v = \max(0.9d,\ 0.72h)
\]

### Simplified method - Clause 11.3.6.3

Where the selected stirrup set provides at least the minimum transverse reinforcement from Eq. 11.1, the app uses:

\[
\theta = 35^\circ
\]

For `fy <= 400 MPa`:

\[
\beta = 0.18
\]

For `fy > 400 MPa`:

\[
\beta = \frac{0.4}{1 + f_y/320}
\]

Where the selected stirrup set does not provide the Eq. 11.1 minimum transverse reinforcement, the app uses the Clause 11.3.6.3 no-minimum-steel beta expressions:

\[
\beta = \frac{230}{1000+d_v}
\]

for `fy <= 400 MPa`, or:

\[
\beta = \frac{520}{(1+f_y/320)(1000+d_v)}
\]

for `fy > 400 MPa`.

If the effective aggregate-size condition requires the equivalent crack-spacing parameter, the app replaces `dv` with `sze` as permitted by the excerpt. The simplified method is flagged when `f'c > 60 MPa`.

### General method - Clause 11.3.6.4

The general method estimates longitudinal strain and calculates beta and theta from epsilon_x:

\[
\epsilon_x = \frac{\max(M_f/d_v,V_f)+V_f}{2E_sA_s}
\]

This is the app's non-prestressed, no-axial-load form of Eq. 11.13. The `max(Mf/dv, Vf)` term implements the condition that `Mf` shall not be taken as less than `Vf dv`.

The app then uses:

\[
\beta = \frac{0.40}{1 + 1500\epsilon_x}\frac{1300}{1000+s_{ze}} \ge 0.05
\]

\[
\theta = 29 + 7000\epsilon_x
\]

The app caps `epsilon_x` at 0.003. If the selected transverse reinforcement satisfies Eq. 11.1, the auto `sze` value is 300 mm. Otherwise, the app uses Eq. 11.10:

\[
s_{ze}=\frac{35s_z}{15+a_g}
\]

with `sze` not less than `0.85 sz`. Because individual longitudinal reinforcement layers are not yet modeled, the app uses `sz = dv` as the documented default approximation. For concrete strengths above 60 MPa, the aggregate-size reduction rule from the excerpt is applied to the effective `ag` used in Eq. 11.10.

## 5. Minimum shear reinforcement and spacing

Minimum shear reinforcement is checked against Clause 11.2.8. The app treats minimum shear reinforcement as required where:

- `Vf > Vc + Vp`; or
- the member is a beam with overall thickness greater than 750 mm.

`Vp = 0` in this app.

Minimum shear reinforcement:

\[
A_{v,min} = 0.06\sqrt{f'_c}\frac{b_w s}{f_{yt}}
\]

Maximum longitudinal spacing follows Clause 11.3.8:

\[
s \le \min(0.7d_v, 600\text{ mm})
\]

If:

\[
V_f > 0.125\lambda\phi_c f'_c b_wd_v + V_p
\]

then the maximum spacing is reduced by half:

\[
s \le \min(0.35d_v, 300\text{ mm})
\]

Again, `Vp = 0` in this app. Clause 11.3.8.4 spacing across the member width is not yet automated because the app does not model the physical transverse location of each stirrup leg.

The scheduled zones are authoritative: spacing and minimum shear steel are evaluated for each scheduled zone, not just the global Zone 1 input.

## 6. Interface shear-transfer resistance

The interface shear-transfer check is referenced to CSA A23.3:24 Clause 11.5. The general expression in the excerpt is:

\[
v_r = \lambda\phi_c(c+\mu\sigma)+\phi_s\rho_v f_y\cos\alpha_f
\]

where:

\[
\sigma=\rho_v f_y\sin\alpha_f+\frac{N}{A_g}
\]

and:

\[
\rho_v = \frac{A_{vf}}{A_{cv}}
\]

The current app implementation assumes vertical reinforcement crossing a horizontal interface:

\[
\alpha_f=90^\circ
\]

and no permanent normal stress:

\[
N/A_g=0
\]

Under those assumptions, the expression reduces to:

\[
v_r = \lambda\phi_c(c+\mu\rho_v f_y)
\]

Solving for required crossing reinforcement:

\[
\rho_{v,req} = \frac{v_f/(\lambda\phi_c)-c}{\mu f_y}
\]

\[
\left(\frac{A_v}{s}\right)_{interface,req} = \rho_{v,req} b_w
\]

Surface assumptions from the excerpt:

| Interface condition | c, MPa | μ |
|---|---:|---:|
| Clean, not intentionally roughened | 0.25 | 0.60 |
| Clean + intentionally roughened to at least 5 mm amplitude | 0.50 | 1.00 |
| Placed monolithically | 1.00 | 1.40 |
| Concrete anchored to as-rolled structural steel | 0.00 | 0.60 |

The app also checks the Eq. 11.25 upper-bound expression:

\[
\lambda\phi_c(c+\mu\sigma) \le 0.25\phi_c f'_c
\]

Clause 11.5.6 anchorage is not automated. The report therefore continues to flag anchorage/development as not checked.

## 7. Conservative steel allocation

The app includes a conservative method to avoid double-counting the same stirrup steel for both vertical beam shear and cold-joint interface shear.

Beam shear steel demand:

\[
\left(\frac{A_v}{s}\right)_{beam,req}
=
\max\left[
0,
\frac{V_f - V_c}{\phi_s f_y d_v \cot\theta}
\right]
\]

Unused primary stirrup steel:

\[
\left(\frac{A_v}{s}\right)_{unused}
=
\max\left[
0,
\left(\frac{A_v}{s}\right)_{primary,provided}
-
\left(\frac{A_v}{s}\right)_{beam,req}
\right]
\]

Additional interface reinforcement required:

\[
\left(\frac{A_v}{s}\right)_{add}
=
\max\left[
0,
\left(\frac{A_v}{s}\right)_{interface,req}
-
\left(\frac{A_v}{s}\right)_{unused}
\right]
\]

The zone check repeats this allocation locally using the zone's selected primary spacing and any added dowels/hairpins.

## 8. Sign-aware flexural reasonableness check

The app performs a simplified stress-block flexural reasonableness check:

- positive sagging moment uses bottom longitudinal steel
- negative hogging moment uses top longitudinal steel

Compression-block depth is solved from equilibrium over the section components. Resistance is then estimated from:

\[
M_r \approx \phi_s A_s f_y z
\]

This is included only as a flag. It does not replace full flexural design, serviceability checks, reinforcement layout review, bar development, compression reinforcement checks, or ductility checks.

## 9. Separated utilization checks

The app no longer sums beam-shear utilization and interface-shear utilization. The checks are evaluated separately:

\[
\frac{V_{beam}}{V_{r,beam}} \le 1.0
\]

\[
\frac{V_{interface}}{V_{r,interface}} \le 1.0
\]

The displayed shear utilization is the governing maximum of the separate checks, not a combined interaction equation.

## 10. Detailing requirements not automated

The app performs a limited detailing review for scheduled spacing, minimum shear steel, and practical spacing limits. It does not automate:

- development length
- anchorage hooks
- lap splice checks
- bar placement clear spacing
- bar congestion and constructability
- interface roughness inspection
- shear-friction reinforcement angle other than vertical crossing bars
- load path from concentrated transfer loads
- torsion
- punching or local bearing near point-load introduction
- full deep beam / strut-and-tie behavior
- discontinuity-region design

Deep-beam/D-region conditions are flagged only. No strut-and-tie model is included.


## v22 notes

The section/material input now includes bottom bar rows, top bar rows, and vertical bar row spacing. These values affect the calculated longitudinal steel centroid and therefore the effective depths used by the flexural reasonableness check, the shear depth calculation, and the cracked-force-flow lever arm calculation.

Calculation Set 8 now reports the interface reinforcement balance in this order: required interface steel, provided primary stirrup steel, portion consumed by vertical beam shear, unused stirrup balance, additional steel required, provided dowels/hairpins, and final required-versus-available status.
