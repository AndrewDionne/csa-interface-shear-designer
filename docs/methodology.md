# Methodology

This document summarizes the calculation logic used by the app. It intentionally does not reproduce CSA standard text. Verify all values, coefficients, and detailing requirements against the governing project edition of CSA A23.3.

## 1. Beam analysis

The app uses a simple Euler-Bernoulli beam finite-element model with vertical translation and rotation degrees of freedom at each station.

Supported systems:

- single-span simply supported
- two-span continuous with simple vertical supports at left, middle, and right
- cantilever with fixed left end
- uniform factored load over the full length
- one optional point load at a user-selected distance from the left end

The FE model is used to calculate reactions. Demand diagrams are then assembled from statics:

\[
V(x) = \sum R_i - w x - \sum P_i
\]

\[
M(x) = \sum R_i(x-x_i) - \frac{w x^2}{2} - \sum P_i(x-x_i) + \sum M_{support}
\]

The point load location is forced into the station list so the shear jump and moment kink are captured.

## 2. Gross-section properties

For a rectangular composite section:

\[
I_g = \frac{b h^3}{12}
\]

For a horizontal interface located at the underside of the second placement slab:

\[
A_{above} = b t_s
\]

\[
Q = A_{above}\left(\frac{h}{2} - \frac{t_s}{2}\right)
\]

This assumes the same concrete modulus above and below the joint.

## 3. Horizontal interface shear demand

Elastic shear flow:

\[
q = \frac{VQ}{I}
\]

Interface stress:

\[
v = \frac{q}{b_i}
\]

The app also includes a cracked force-flow approximation:

\[
q \approx \frac{V}{z}
\]

where:

\[
z = (z/d)d
\]

The user can design for:

- elastic `VQ/I`
- cracked `V/z`
- envelope max of both

## 4. Vertical beam shear

The simplified CSA-style method used in the app is:

\[
V_c = \phi_c \lambda \beta \sqrt{f'_c} b_w d_v
\]

with default:

\[
\beta = 0.18
\]

\[
\theta = 35^\circ
\]

\[
V_s = \phi_s \frac{A_v f_y d_v \cot\theta}{s}
\]

\[
V_r = V_c + V_s
\]

The effective shear depth is calculated as:

\[
d_v = \max(0.9d,\ 0.72h)
\]

The effective depth `d` is estimated from total depth, cover, stirrup diameter, and main-bar diameter. For production use, confirm this against the actual bar layer geometry.

## 5. Minimum shear reinforcement and spacing

The app checks minimum shear reinforcement in the form:

\[
A_{v,min} = 0.06\sqrt{f'_c}\frac{b_w s}{f_y}
\]

The spacing limit is selected using a simplified high-shear threshold check:

\[
V_{threshold} = 0.125\lambda \phi_c \sqrt{f'_c} b_w d_v
\]

If the maximum shear demand exceeds this threshold:

\[
s_{max} = \min(0.35d_v,\ 300 mm)
\]

Otherwise:

\[
s_{max} = \min(0.7d_v,\ 600 mm)
\]

Confirm final spacing requirements against the governing CSA A23.3 edition.

## 6. Interface shear-transfer resistance

The app uses the CSA-style interface-shear form:

\[
v_r = \lambda\phi_c(c+\mu\rho_v f_y)
\]

for vertical reinforcement crossing a horizontal interface. This means the reinforcement contributes clamping stress normal to the shear plane.

Solving for required crossing reinforcement:

\[
\rho_{v,req} = \frac{v_f/(\lambda\phi_c)-c}{\mu f_y}
\]

\[
\left(\frac{A_v}{s}\right)_{interface,req} = \rho_{v,req} b_i
\]

Default surface assumptions:

| Interface condition | c, MPa | μ |
|---|---:|---:|
| Clean + intentionally roughened | 0.50 | 1.00 |
| Clean, not intentionally roughened | 0.25 | 0.60 |

The app also checks a concrete upper-bound limit:

\[
v \le 0.25\phi_c f'_c
\]

## 7. Conservative steel-allocation option

The app includes a conservative method to avoid double-counting the same stirrup steel for both diagonal beam shear and cold-joint interface shear.

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

The user can alternatively select an independent check that counts the full crossing stirrup steel toward interface shear. The balance method is more conservative.

## 8. Flexural estimate

The app includes a rough singly-reinforced rectangular stress-block flexural estimate:

\[
\alpha_1 = 0.85 - 0.0015f'_c
\]

\[
\beta_1 = 0.97 - 0.0025f'_c
\]

with lower bounds applied in the app.

\[
a = \frac{\phi_s A_s f_y}{\alpha_1 \phi_c f'_c b}
\]

\[
M_r \approx \phi_s A_s f_y(d-a/2)
\]

This is included only as a flag. It does not replace full flexural design, serviceability checks, reinforcement layout review, bar development, or compression reinforcement checks.

## 9. Canadian rebar data

The app includes common Canadian metric bar areas and nominal diameters:

| Bar | Area, mm² | Diameter, mm |
|---|---:|---:|
| 10M | 100 | 11.3 |
| 15M | 200 | 16.0 |
| 20M | 300 | 19.5 |
| 25M | 500 | 25.2 |
| 30M | 700 | 29.9 |
| 35M | 1000 | 35.7 |
| 45M | 1500 | 43.7 |
| 55M | 2500 | 56.4 |

## 10. Detailing requirements not automated

The app does not automate:

- development length
- anchorage hooks
- lap splice checks
- bar placement limits
- clear spacing
- constructability / congestion
- interface roughness inspection
- shear-friction reinforcement angle other than vertical crossing bars
- load path from concentrated transfer loads
- torsion
- punching or local bearing near point-load introduction
- deep beam / strut-and-tie behavior
- discontinuity-region design

For transfer beams, point loads may create local D-regions that should be reviewed separately.
