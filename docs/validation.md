# Validation Notes

The default example should broadly match the previous hand calculation.

## Default simple-span UDL

Inputs:

- L = 16 m
- Wf = 544 kN/m
- no point load

Expected statics:

\[
R_A = R_B = W_f L / 2 = 4352 kN
\]

\[
M_{max} = W_f L^2/8 = 17408 kN·m
\]

The app should report approximately:

- max |Vf| = 4352 kN
- max +Mf = 17408 kN·m
- max elastic interface q = approximately 2270 kN/m
- max interface stress = approximately 0.757 MPa

Minor differences may occur due to station discretization.

## Two-span continuous UDL sanity check

For two equal spans with UDL over both spans and equal EI, the internal support moment should be approximately:

\[
M_B \approx -wL^2/8
\]

The end reactions should be lower than the internal support reaction.

## Cantilever UDL sanity check

For a cantilever of length L:

\[
V_{support} = wL
\]

\[
M_{support} = -wL^2/2
\]

Sign conventions in the chart show hogging moment as negative.
