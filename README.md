# MTC-180 (`v5.1` Floor-Flush) — Rubric-Compliant 3-Mousetrap Cord-Driven Golf-Ball Catapult

**Live Simulator & Rubric Evaluator:** [https://halbritt.github.io/mtc180/](https://halbritt.github.io/mtc180/)

![Complete Floor-Flush Launch Sequence: Rear Pull-String -> Gravity Sear -> Bail Stroke -> 42° CoP Stop & Golf Ball Trajectory](docs/images/mtc180_floorflush_launch.gif)

Parametric [Cadpole](https://github.com/halbritt/cadpole) CAD and [CalculiX 2.23](http://www.dhondt.de/) `C3D8I` two-phase FDM PETG finite-element model engineered for strict compliance with *The Mousetrap Catapult* rubric (`Design #1–#7`, `Materials #1–#2`) and verified against `IMG_4479.jpg` physical spring-clearance photometry:

1. **100% Floor-Flush Flat Base (`Design #4` & `#5`):** Single `470 × 204 × 18.0 mm` (`18.5" × 8.0" × 0.71"`, **`≤ 1"`**) plywood board sitting dead flush on the floor inside the **`2' × 2'`** launch box (`20.2"` diagonal << `3 ft` max diameter). All three stripped Victor mousetraps screw **right-side up and dead flat (`0.00°`)** onto the base (`springs 100% unaltered`).
2. **Photometry-Verified Torsion-Spring Clearance (`IMG_4479.jpg`):** Calibrated at `21.64 px/mm`, each Victor trap's black torsion-spring moving leg crosses over the left copper bail wire (`Y = yc - 19.35 mm`) and terminates at **`X = 25.7 mm, Y = yc - 21.2 mm`**. Starting `cad/bail_coupler.star` at **`X_MIN = 28.50 mm`** provides **`> 2.8 mm` axial clearance** on all three traps (`assert_true(ds.distance > 2.0)` across all poses) while keeping solid `1.52 mm` driven-side PETG floors under all six `38.70 mm` C-to-C wires.
3. **Through-Bolted Cord-and-Horn Linkage (`> 5.0 m` Carry, `+5.0°` Dead-Centre Stop Margin) + `< 3"` Ball Height:** A braided non-stretch cord runs from the `16.3 cm³` 3-bail coupler (`R_PULL = 50.8 mm`, `XH = 124.0 mm`) under a free-spinning `M4` V-roller (`(48, 43) mm`) to a **through-bolted `M4 × 16` cord post** (`washer + hex nut` on a `Ø7.6 mm` collar centered on `Y = 0`) on the `12 mm`-wide throwing arm's horn (`108 mm` at `39.0°` from pivot `(-96, 72) mm`, `L_BALL = 170.0 mm`). The horn reaches dead centre at `53.0°` (**`+5.0°` safety margin past the `42°` stop**, preventing rubber-sleeve compression from crossing dead centre) while sweeping the bails `171° -> 34°` on a taut cord at only **`84 N` peak dynamic cord tension** (down from `136 N`) for **`6.93 m/s` (`5.08 m` air carry)**.
   - **Why not a cam:** the earlier `R = 98 mm` circular cam needed constant cord payout while the bail lever arm collapsed late in the stroke, going slack at `53°` (`5.2 m/s`, `2.9 m`).
   - **Cocked ball bottom height (`< 3.00"` across Notches 6, 5, and 4):** **`27.6 mm` (`1.09"`)** at Notch 6, **`51.4 mm` (`2.02"`)** at Notch 5, and **`75.1 mm` (`2.96"`)** at Notch 4 in an open top-loading `45°` V-cradle (`~0.5 s` drop-in reload for `6–8 balls` in `< 90 s`).
   - **Center-of-Percussion Stop Sleeve (`42° / 50° / 58°` quick-pin holes):** `Ø14.4 mm` PETG core wrapped with `2.8 mm` rubber (`Ø20.0 mm` OD) catches the upper truss chord near its center of percussion; combining Notches `6/5/4` with the `42°/50°/58°` stop pins covers `1.7–5.1 m` while keeping ball start height `< 3.0"` on every shot.
4. **Zero Rubber Bands — 6-Notch Range Quadrant + Gravity Ratchet Sear (`Design #6`, Day 2 Accuracy):** A counterweighted 1-piece PETG sear pawl (`cad/stanchion_trigger.star`) pivots on an `M4` bolt (`(-116, 33) mm`) with **gravity alone** tipping its tooth into **6 CAD-verified range notches** (`a_lock = -89.25° + ψ_cock`, verified `< 0.85 mm` engagement across all 6 notches in `cadpole test`), tripped from behind by a braided pull-string (`~84 N` tooth compression in self-locking geometry).
5. **100% `M4` Hardware (`Zero M3 Needed`):** Uses `6×` `M4 × 6–8 mm` screws + `M4` washers on the 3-bail coupler, `1×` `M4 × 16 mm` bolt + `M4` washer + `M4` hex nut through the horn's cord post, `4×` `M4 × 45 mm` bolts/pins through the stanchion bores (`20.4 mm` inner gap), and `#6` / `M4` wood screws into the `3/4"` plywood board.

## Alternative: Direct-Drive Rail Arm (arm bolted straight to the three traps)

![Direct-drive launch: hook sear released, ball rolls out along the rails and leaves the tip, bare arm lands on the foam stop](docs/images/mtc180_direct_launch.gif)

A second, simpler build that shares the same base, flat traps and `mtc180_bail_coupler`: instead of the cord, horn arm, pivot and stanchions, a 32 g rail arm (`cad/direct_arm.star`) bolts directly onto the coupler's flat driven face with the same six `M4` screws (use `M4 × 10` instead of `× 6–8`).

**Why it is not a cup.** With the traps flat on a floor-flush base the arm can only swing in the half-plane above the floor. A ball held rigidly on such an arm is moving *upward* only while the arm is behind vertical, so it must be released in roughly the first 60° of the 166° stroke; in the model that tops out near 2.3 m. This arm instead lets the ball **roll outward along two rails** while the bails swing. The outward speed adds to the tangential speed, so the ball leaves the tip heading about 34° upward when the arm is vertical, after about 85° of stroke. In the models the ball gets about 0.8 J here against about 1.1 J from the cord-and-horn arm, so expect roughly 70% of that design's `~5.1 m` carry.

| Backstop hole | Ball start radius | Release (arm angle / elevation / speed) | Model carry (rolling) | Carry if the ball slides | Carry at −20% / +20% spring energy |
| --- | --- | --- | --- | --- | --- |
| **1A (max — Day 1)** | `80 mm` | `88° / 34° / 5.9 m/s` | **`3.6 m`** | `3.4 m` | `2.9 m` / `4.3 m` |
| 2A | `91 mm` | `94° / 38° / 5.7 m/s` | `3.5 m` | `3.0 m` | `2.8 m` / `4.1 m` |
| 3A | `102 mm` | `100° / 42° / 5.5 m/s` | `3.2 m` | `2.6 m` | `2.6 m` / `3.9 m` |
| 5A | `122 mm` | `112° / 49° / 5.0 m/s` | `2.7 m` | `1.8 m` | `2.1 m` / `3.2 m` |
| 7A | `143 mm` | `124° / 56° / 4.5 m/s` | `1.9 m` | `1.1 m` | `1.6 m` / `2.3 m` |
| 9A | `164 mm` | `138° / 64° / 3.8 m/s` | `1.1 m` | `0.6 m` | `0.9 m` / `1.4 m` |

*(`mise run sim` prints all 20 positions. These are model numbers: the spring energy (`2.12 J` for three traps) and its torque curve are assumed, not measured, and nothing here has been printed or fired. Calibrate the table on the real machine before Day 2.)*

- **Rail faces:** the ball rides on a 3 mm wide flat face on top of each rail, tilted 20° to lie tangent to the ball, with the contact lines 14.9 mm apart. A dimple at the contact point bears on the face, where a sharp edge would drop into it. The faces do not raise friction; they add 2.4 g to the arm, which costs about 2% of carry in the model.
- **Day 2 adjustment:** the ball rests against a small backstop block between the rails. Ten holes at 10 mm pitch, and the block's off-centre screw gives 5 mm half-steps when turned round ("A"/"B"), so each step moves the landing point by about 0.1–0.2 m. Moving the ball outward shortens and steepens the throw.
- **Loading:** cock the arm back flat (173°), swing the hook sear over the tongue ridge, then drop the ball on the rails; they slope 3° toward the hinge when cocked, so the ball seats itself against the backstop. Cocked ball bottom is about 55 mm (2.2") off the floor, inside the 3" rule.
- **Trigger (`cad/direct_trigger.star`):** a C-hook on an `M4` bolt in a clevis bracket screwed to the base under the arm tip. Latch load is about 4.5 N and passes almost through the pivot; pull the string rearward to fire.
- **Stop:** after the ball leaves, the bare arm keeps accelerating and reaches the stop with about 0.9 J (tip speed around 14 m/s). It lands at 14° on a printed wedge carrying a **10 mm soft foam pad** near the arm's centre of percussion. Keep fingers out of the arc.
- **Parts:** `exports/direct/mtc180_direct_arm_h2s.3mf` (arm, 25.5 cm³) and `exports/direct/mtc180_direct_kit_h2s.3mf` (backstop, hook, bracket, stop wedge, 26.7 cm³), plus the existing bail coupler. Extra hardware: `6× M4 × 10` (coupler + arm), `1× M4 × 10` (backstop), `1× M4 × 25` bolt + nut (sear pivot), `6×` wood screws.
- **Checks:** `cad/print_direct_arm.star`, `cad/print_direct_kit.star` and `cad/installed_direct.star` (10-pose rubric, spring-clearance, sear, stop and ball-path sweep) run under `mise run test`.

## Repository Layout & Verification Commands

- `cad/bail_coupler.star` & `cad/print_bail_coupler.star` — Spring-cleared (`X >= 28.5 mm`) driven-side 3-bail coupler (`16.28 cm³` CAD, `6× M4` washer locks).
- `cad/throwing_arm.star` & `cad/print_throwing_arm.star` — `12 mm` monolithic throwing arm (through-bolted `M4 × 16` cord horn + `6-notch` sear quadrant + self-centering `45°` V-cup + centrifugal backstop).
- `cad/stanchion_trigger.star` & `cad/print_stanchion_kit.star` — Left/right mirrored A-frame stanchions (`42°/50°/58°` CoP stop holes), stop sleeve, `M4` V-roller, and counterweighted gravity sear pawl.
- `cad/linkage.star` — Exact drive-cord kinematics (eye → roller → horn post) shared by the assembly.
- `cad/installed_floorflush.star` — Full 8-pose launch + 6-notch sear, `< 3"` rubric, cord-path & `IMG_4479` spring-clearance test suite + 64-frame launch animation.
- `analysis/cam_launch_sim.py` — Launch model for the cord linkage (taut/slack cord, bail and arm inertia); prints the range table.
- `cad/direct_arm.star`, `cad/direct_trigger.star`, `cad/installed_direct.star`, `analysis/direct_arm_sim.py` — Direct-drive rail-arm alternative (arm bolted to the coupler) and its launch model.
- `fea/run_floorflush_fea.py` — CalculiX 2.23 `C3D8I` two-phase FDM (`PETG_SHELL` + `PETG_GYROID15`) solver.

```sh
mise run test       # Run all 29 Cadpole H2S 3-nozzle printability, 6-notch sear, spring-clearance (>2mm), and rubric checks
mise run export     # Rebuild exports/*.stl, *.3mf, *.pdf, *.svg (and exports/direct/*)
mise run animate    # Rebuild both 64-frame floor-flush and direct-drive animated launch GIFs
mise run fea        # Run CalculiX 2.23 C3D8I two-phase FDM stress & inertia study
mise run camsim     # Cord-linkage launch model: range table and sensitivities (--cam 96.5 --th-cock 156 = the old cam)
mise run sim        # Direct-drive 2-DOF rolling/sliding rail launch model across all 20 backstop positions
```

## CalculiX 2.23 `C3D8I` FEA (`v5.1`, `20,821` Coupler + `16,197` Arm Bricks)

| Component / Load Case (`mise run fea`) | Verified Result (`Two-Phase FDM PETG`: `1.8 mm` Shell + `15%` Gyroid) |
| --- | --- |
| **3-Bail Coupler (`16.28 cm³`, `85 N` peak dynamic cord pull)** | $I_{\text{coupler}} = 0.319\text{ kg·cm}^2$, $U_{\max} = 0.13\text{ mm}$, $\sigma_{\text{VM},99.8\%} = 3.88\text{ MPa}$ |
| **12 mm Throwing Arm (`84.82 cm³`, `55.4 g` PETG + `4.0 g` M4×16 post bolt/nut)** | $I_{\text{arm}} = 3.980\text{ kg·cm}^2$, $v_0 = 6.93\text{ m/s}$ (**`5.08 m` carry at `42°`**, `84 N` peak cord) |
| **Arm LC1: Peak Dynamic Cord Pull (`85 N` at `+21°` on through-bolted collar)** | $\sigma_{\text{VM},99.8\%} = 2.72\text{ MPa}$ |
| **Arm LC2: CoP Padded Stop Sleeve (`Ø20.0 mm` OD, `380 N/mm` rubber, `416 N`)** | $\sigma_{\text{VM},99.8\%} = 11.87\text{ MPa}$ (`4.2×` safety factor to `50 MPa` PETG yield) |
| **Arm LC3: Full-Cock Ratchet Tooth #6 Standby (`31 N` static cord)** | $\sigma_{\text{VM},99.8\%} = 1.64\text{ MPa}$ (`83.5 N` tooth compression into gravity sear) |

## Day 1 Max Distance & Day 2 Accuracy Range Table (model, `mise run camsim`)

| Ratchet Sear Notch | Arm Cock (`ψ_cock`) & Ball Start Height | Bail Windup (`θ_bail`) | `42°` hole: speed / carry | `50°` hole: speed / carry | `58°` hole: speed / carry |
| --- | --- | --- | --- | --- | --- |
| **Notch #6 (`MAX` — Day 1)** | `-8.2°` (**`1.08"` `< 3"`**) | `171°` | `6.9 m/s` / **`5.1 m`** | `6.2 m/s` / **`4.0 m`** | `5.8 m/s` / **`3.1 m`** |
| **Notch #5** | `-0.2°` (**`2.02"` `< 3"`**) | `146°` | `6.1 m/s` / **`4.0 m`** | `5.4 m/s` / **`3.1 m`** | `4.9 m/s` / **`2.3 m`** |
| **Notch #4** | `+7.8°` (**`2.96"` `< 3"`**) | `129°` | `5.5 m/s` / **`3.3 m`** | `4.8 m/s` / **`2.5 m`** | `4.2 m/s` / **`1.7 m`** |
| **Notch #3** | `+16.5°` (`3.96"`) | `110°` | `4.9 m/s` / **`2.6 m`** | `4.1 m/s` / `1.8 m` | `3.3 m/s` / `1.1 m` |
| **Notch #2** | `+25.5°` (`4.94"`) | `90°` | `4.1 m/s` / **`1.9 m`** | `3.2 m/s` / `1.2 m` | `2.2 m/s` / `0.5 m` |
| **Notch #1 (Short)** | `+34.5°` (`5.86"`) | `67°` | `3.1 m/s` / **`1.1 m`** | `2.0 m/s` / `0.5 m` | — |

- These are model numbers (`2.12 J` assumed for three traps over `180°`). With springs `20%` weaker, full-cock carry is `4.1 m`; `20%` stronger, `6.1 m`. Calibrate on the real machine before Day 2.
- **Strict `< 3"` Day 2 mode:** Notches **#6, #5, and #4** all hold the cocked golf ball strictly within `3.00"` of the floor (`1.08"`, `2.02"`, `2.96"`). Combining Notches `#6/#5/#4` with the `42° / 50° / 58°` quick-pin stop holes covers **`1.7 m` to `5.1 m`** without ever exceeding `3.00"` ball height.
- **Tying the cord:** push the arm down into Notch #6 (`-8.2°`) and tie the non-stretch loop onto the `Ø7.6 mm` horn collar so the bails sit `~2°` off flat back (`171°`); tighten the `M4 × 16` bolt + washer + rear hex nut (`1–2 mm` longer cord only shifts carry by `0.16–0.28 m`).

## Bambu Lab H2S Print Plates (PETG, Supports OFF, Arachne ON, 15% Gyroid)

- **Download Bundle (`3t8uyn`):** [`bundle.zip`](https://artifact.harm.org/3t8uyn/_artifact/bundle.zip) · [Browse All Exports](https://artifact.harm.org/3t8uyn/_artifact/) · [Floor-Flush Launch GIF](https://artifact.harm.org/3t8uyn/mtc180_floorflush_launch.gif) · [Direct-Drive Launch GIF](https://artifact.harm.org/3t8uyn/direct/mtc180_direct_launch.gif)
- **Interactive 3D Viewer (`v5.1`):** [Full Assembly](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/zbhr5x/mtc180_floorflush_assembly_v5_1.glb) · [3-Bail Coupler](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/wvysq5/mtc180_bail_coupler_v5_1.glb) · [`12 mm` Cord-Horn Arm](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/ru6n18/mtc180_throwing_arm_v5_1.glb) · [Stanchions + Sear Kit](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/9dvtq1/mtc180_stanchion_kit_v5_1.glb)

| Plate (`exports/*_h2s.3mf`) | Recommended Nozzle | Layer × Width | PETG Mass | Extrusion Time |
| --- | --- | --- | --- | --- |
| **1. [`mtc180_bail_coupler`](https://artifact.harm.org/3t8uyn/mtc180_bail_coupler_h2s.3mf?download=1) (`16.3 cm³` — Print & Test-Fit First)** | `0.6 mm` TC / `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | **`~12 g`** | **`~5.5 min`** |
| **2. [`mtc180_throwing_arm`](https://artifact.harm.org/3t8uyn/mtc180_throwing_arm_h2s.3mf?download=1) (`84.8 cm³` — 12 mm Truss + Through-Bolted Horn)** | `0.6 mm` TC / `0.8 mm` TC | `0.40 × 0.88 mm` (`2` / `3` walls) | **`~49–55 g`** | **`~22 min`** |
| **3. [`mtc180_stanchion_kit`](https://artifact.harm.org/3t8uyn/mtc180_stanchion_kit_h2s.3mf?download=1) (`309.9 cm³` — 5 Parts, Centered Plate)** | `0.6 mm` TC / `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | **`~165 g`** | **`~70 min`** |

## Hardware BOM (100% `M4` — Zero `M3`, Zero Rubber Bands)

- **Wood Base:** `1×` `470 × 204 × 18 mm` (`18.5" × 8.0" × 3/4"`, `≤ 1"`) flat plywood board.
- **Mousetraps:** `3×` standard Victor mousetraps (`46.1 × 98.4 mm`; strip only the bait pedal and loose trigger wire — leave all springs and spring-anchoring staples untouched), screwed flat (`0.00°`) side-by-side at `X = 74.8..173.2 mm` (`hinge at X = 124.0 mm`).
- **3-Bail Coupler Locks:** `6×` `M4 × 6–8 mm` screws + `6×` `M4` fender washers (`9–12 mm` OD) into the self-tapping `Ø3.5 mm` bosses.
- **Through-Bolted Cord Post:** `1×` `M4 × 16 mm` bolt + `1×` `M4` fender washer (`≤ 12 mm` OD) + `1×` `M4` hex nut clamping across the horn tip (`cord loop turns on the Ø7.6 mm printed collar centered on Y = 0`).
- **Stanchion Axles & Mounting:** `4×` `M4 × 45 mm` bolts/pins (arm pivot, front cord roller, gravity sear pivot, and quick-pin CoP stop sleeve across the `20.4 mm` stanchion gap) + `6×` `M4` or `#6` wood screws through the outboard stanchion L-flanges into the plywood base.
- **Cord & Cushioning:** Non-stretch braided Dacron/nylon cord (`~260 mm` drive cord + `~300 mm` rear trigger string) and `2.8–3 mm` adhesive rubber/foam strip on the CoP stop sleeve and front bail landing pad.

## Browser shot telemetry

Open [https://halbritt.github.io/mtc180/](https://halbritt.github.io/mtc180/), or run `npm ci` and `npm run dev` from the repository root. The field view opens
with a synthetic example. Use **Import trace** to view your own completed
trajectory. Select **Play** to follow the ball from release to rest. The slider
pauses playback at the chosen time. Use **Speed** for half- or quarter-speed
replay. The marker follows straight segments between timestamped positions.
The **Trace format** panel contains a downloadable JSON example.
Use `npm test` for the headless telemetry and rubric tests and `npm run build` for the
TypeScript check and production bundle.

Carry and total distance are horizontal displacements from the release point
to first contact and final rest respectively. Bounce/rollout is the horizontal
path length between sampled positions after first contact. Apex is the highest
sampled altitude. Radial error is the horizontal distance from rest to the
optional target point. Lateral error is signed crossrange offset from that
point.

### Practice targets

Open **Practice targets** and enter a centre offset from release (downrange and
crossrange, in metres). Set a circle radius or the full length and width of a
rectangle. Choose **First contact** or **Final rest**, then **Apply target**.
The field shows the footprint. A point on its edge counts as a hit in this
practice scenario.

Import trials with distinct filenames to compare them against the same target.
Optional text fields `design` and `setting` in the trace JSON identify the
configuration the operator selected. Reimporting a filename replaces its result.
The first imported trace replaces the synthetic example in the comparison.
Changing the practice target reevaluates all loaded trials. **Clear target**
restores the current trace’s original target. Competition hits remain
judge-entered.

### Competition scorecard

The scorecard follows *The Mousetrap Catapult Project*, pp. 2–4. Enter the
distance accepted by the judge on Day 1. Each completed metre from 1 to 5 earns
2 points, up to 10. On Day 2 each of the two targets is worth 5 points for a hit.
For example, a recorded 4.99 m and one hit across the two targets earn 13 of
the 20 competition points.

The handout leaves the distance measurement endpoint unspecified. The two
targets are straight ahead at different distances. Their sizes and distances
are announced on competition day. The handout estimates 3–4 minutes for 6–8
balls and allows either a football field or tennis courts. The scorecard uses
the recorded competition outcomes. To score an imported trace, explicitly choose
its carry or total distance according to the judge's convention. Importing a new
trace preserves the scorecard entries.

The other 90 base points cover the catapult (20), design paragraph (20),
physics paragraph (25), diagram (15), and group performance (10). The equipment
bonus is +4 for a real golf ball, +6 for a gravity-powered sling trebuchet, or
+8 for both together. Group members divide a separate pool of exactly 6 points.
Late work loses 10 points per day.

Two details distinguish the handout from the build notes above. The ball
must pass within 3 inches of the ground at some point during launch.
Rubber bands are allowed for attachment.
