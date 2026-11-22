# MTC-180 (`v5` Floor-Flush) — Rubric-Compliant 3-Mousetrap Cam-Driven Golf-Ball Catapult

![Complete Floor-Flush Launch Sequence: Rear Pull-String -> Gravity Sear -> 166° Bail Stroke -> 42° CoP Stop & Golf Ball Trajectory](docs/images/mtc180_floorflush_launch.gif)

Parametric [Cadpole](https://github.com/halbritt/cadpole) CAD and [CalculiX 2.23](http://www.dhondt.de/) `C3D8I` two-phase FDM PETG finite-element model engineered for strict compliance with *The Mousetrap Catapult* rubric (`Design #1–#7`, `Materials #1–#2`) and verified against `IMG_4479.jpg` physical spring-clearance photometry:

1. **100% Floor-Flush Flat Base (`Design #4` & `#5`):** Single `450 × 204 × 18.0 mm` (`17.7" × 8.0" × 0.71"`, **`≤ 1"`**) plywood board sitting dead flush on the floor inside the **`2' × 2'`** launch box (`19.4"` diagonal << `3 ft` max diameter). All three stripped Victor mousetraps screw **right-side up and dead flat (`0.00°`)** onto the base (`springs 100% unaltered`).
2. **Photometry-Verified Torsion-Spring Clearance (`IMG_4479.jpg`):** Calibrated at `21.64 px/mm`, each Victor trap's black torsion-spring moving leg crosses over the left copper bail wire (`Y = yc - 19.35 mm`) and terminates at **`X = 25.7 mm, Y = yc - 21.2 mm`**. Starting `cad/bail_coupler.star` at **`X_MIN = 28.50 mm`** provides **`> 2.8 mm` axial clearance** on all three traps (`assert_true(ds.distance > 2.0)` across all 8 poses) while keeping solid `1.52 mm` driven-side PETG floors under all six `38.70 mm` C-to-C wires.
3. **Full `166°` Spring Stroke + `< 3"` Ball Height via `R = 98 mm` Cam Linkage:** A braided non-stretch cord runs from the `16.3 cm³` 3-bail coupler (`R_PULL = 50.8 mm`) under a free-spinning `M4` V-roller (`(34, 39) mm`) onto the `45°` V-grooved **`R = 98.0 mm` circular cam sector** (`R_eff = 96.5 mm`) of the monolithic throwing arm (`L_BALL = 170.0 mm`). That converts the full `173° → 7°` bail sweep (`92.2 mm` monotonic cord pull) into a `-6.7° → +48.0°` upward throwing arc:
   - **Cocked ball bottom height:** **`30.7 mm` (`1.21 inches` — `< 3.00 inches` rubric limit)** in an open top-loading `45°` V-cradle (`~0.5 s` drop-in reload for `6–8 balls` in `< 90 s`).
   - **Center-of-Percussion Stop Sleeve (`34° / 42° / 50°` quick-pin holes):** `Ø14.4 mm` PETG core wrapped with `3 mm` rubber (`Ø20.4 mm` OD) catches the upper truss chord near its center of percussion with `> 83 mm` ball flight clearance.
4. **Zero Rubber Bands — 6-Notch Range Quadrant + Gravity Ratchet Sear (`Design #6`, Day 2 Accuracy):** A counterweighted 1-piece PETG sear pawl (`cad/stanchion_trigger.star`) pivots on an `M4` bolt with **gravity alone** tipping its tooth into **6 calibrated range notches** (`Notch 6 = ~6.4 m` full cock for Day 1 max distance; `Notches 5..1 = ~5.0, 4.1, 3.2, 2.5, 1.7 m` for Day 2 two-target accuracy), tripped from behind by a braided pull-string (`~2.2 N` pull while holding the rear of the board flush to the floor).
5. **100% `M4` Hardware (`Zero M3 Needed`):** Uses `M4` washers + self-tapping `M4 × 6–8 mm` screws on the 3-bail coupler, `4×` `M4 × 45–50 mm` bolts/pins through the stanchion bores (arm pivot, cord roller, sear pawl, and 3-angle stop sleeve), and `#6` / `M4` wood screws into the `3/4"` plywood board.

## Repository Layout & Verification Commands

- `cad/bail_coupler.star` & `cad/print_bail_coupler.star` — Spring-cleared (`X >= 28.5 mm`) driven-side 3-bail coupler (`16.28 cm³` CAD, `6× M4` washer locks).
- `cad/throwing_arm.star` & `cad/print_throwing_arm.star` — Monolithic throwing arm (`R = 98 mm` V-cam + `6-notch` sear quadrant + self-centering `45°` V-cup + centrifugal backstop).
- `cad/stanchion_trigger.star` & `cad/print_stanchion_kit.star` — Left/right mirrored A-frame stanchions (`34°/42°/50°` CoP stop holes), stop sleeve, `M4` V-roller, and counterweighted gravity sear pawl.
- `cad/installed_floorflush.star` — Full 8-pose rubric & `IMG_4479` spring-clearance test suite + 64-frame launch animation.
- `fea/run_floorflush_fea.py` — CalculiX 2.23 `C3D8I` two-phase FDM (`PETG_SHELL` + `PETG_GYROID15`) solver.

```sh
mise run test       # Run all 11 Cadpole H2S 3-nozzle printability, spring-clearance (>2mm), and rubric checks
mise run export     # Rebuild exports/*.stl, *.3mf, *.pdf, *.svg
mise run animate    # Rebuild 64-frame floor-flush animated launch GIF
mise run fea        # Run CalculiX 2.23 C3D8I two-phase FDM stress & inertia study
```

## CalculiX 2.23 `C3D8I` FEA (`v5`, `20,821` Coupler + `22,646` Arm Bricks)

| Component / Load Case (`mise run fea`) | Verified Result (`Two-Phase FDM PETG`: `1.8 mm` Shell + `15%` Gyroid) |
| --- | --- |
| **3-Bail Coupler (`16.28 cm³`, `~12 g` `.6 TC` slice, `95 N` cord pull)** | $I_{\text{coupler}} = 0.319\text{ kg·cm}^2$, $U_{\max} = 0.14\text{ mm}$, $\sigma_{\text{VM},99.8\%} = 4.37\text{ MPa}$ |
| **Throwing Arm (`125.51 cm³`, `~72 g` `.6 TC` slice, `L = 170 mm`)** | $I_{\text{arm}} = 6.096\text{ kg·cm}^2$, $v_0 = 7.36\text{–}7.55\text{ m/s}$ (**`5.7–6.0 m` carry at `42°`** — exceeds `5.0 m` rubric max) |
| **Arm LC1: Peak Launch Drive (`65 N` cam cord + `35 N` ball load)** | $\sigma_{\text{VM},99.8\%} = 3.62\text{ MPa}$ |
| **Arm LC2: CoP Padded Stop Sleeve (`Ø20.4 mm` OD, `380 N/mm` rubber)** | $\sigma_{\text{VM},99.8\%} = 15.23\text{ MPa}$ (`3.3×` safety factor to `50 MPa` PETG yield) |
| **Arm LC3: Full-Cock Ratchet Tooth #6 Standby** | $\sigma_{\text{VM},99.8\%} = 0.88\text{ MPa}$ (`48.2 N` tooth compression into gravity sear) |

## Day 1 Max Distance & Day 2 Accuracy Range Table (`42°` Stop Pin Hole)

| Ratchet Sear Notch | Arm Cock Angle (`ψ_cock`) | Bail Windup (`θ_bail`) | Exit Speed (`v0`) | Air Carry (`+` Roll on Court/Turf) |
| --- | --- | --- | --- | --- |
| **Notch #6 (`MAX` — Day 1)** | `-6.7°` (`ball 1.21" off floor`) | `173.0°` | `~7.5 m/s` | **`~5.9 m`** (`10/10` Distance pts) |
| **Notch #5** | `+2.2°` | `147.5°` | `~6.7 m/s` | **`~4.8 m`** |
| **Notch #4** | `+11.2°` | `130.5°` | `~6.0 m/s` | **`~3.9 m`** |
| **Notch #3** | `+19.6°` | `114.0°` | `~5.3 m/s` | **`~3.1 m`** |
| **Notch #2** | `+28.0°` | `97.0°` | `~4.6 m/s` | **`~2.4 m`** |
| **Notch #1 (Short)** | `+35.8°` | `78.5°` | `~3.8 m/s` | **`~1.7 m`** |

*(Moving the `M4` stop-sleeve quick-pin between the `34°`, `42°`, and `50°` top stanchion holes provides fine `±0.25 m` trajectory trim between notches.)*

## Bambu Lab H2S Print Plates (PETG, Supports OFF, Arachne ON, 15% Gyroid)

| Plate (`exports/*_h2s.3mf`) | Recommended Nozzle | Layer × Width | PETG Mass | Extrusion Time |
| --- | --- | --- | --- | --- |
| **1. `mtc180_bail_coupler` (`16.3 cm³` — Print & Test-Fit First)** | `0.6 mm` TC / `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | **`~12 g`** | **`~5.5 min`** |
| **2. `mtc180_throwing_arm` (`125.5 cm³` — 14 mm Spoked Truss)** | `0.6 mm` TC / `0.8 mm` TC | `0.40 × 0.88 mm` (`2` / `3` walls) | **`~72 g`** | **`~31–32 min`** |
| **3. `mtc180_stanchion_kit` (`270.3 cm³` — 5 Parts)** | `0.6 mm` TC / `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | **`~145 g`** | **`~62 min`** |

## Hardware BOM (100% `M4` — Zero `M3`, Zero Rubber Bands)

- **Wood Base:** `1×` `450 × 204 × 18 mm` (`17.7" × 8.0" × 3/4"`, `≤ 1"`) flat plywood board.
- **Mousetraps:** `3×` standard Victor mousetraps (`46.1 × 98.4 mm`; strip only the bait pedal and loose trigger wire — leave all springs and spring-anchoring staples untouched), screwed flat (`0.00°`) side-by-side at `X = 62.8..161.2 mm`.
- **3-Bail Coupler Locks:** `6×` `M4 × 6–8 mm` screws + `6×` `M4` fender washers (`9–12 mm` OD) into the self-tapping `Ø3.5 mm` bosses (C-jaw snap lips + spring preload also hold the wires screwless for initial test fits).
- **Stanchion Axles & Mounting:** `4×` `M4 × 35–45 mm` bolts/pins (arm pivot, front cord roller, gravity sear pivot, and quick-pin CoP stop sleeve) + `6×` `M4` or `#6` wood screws through the outboard stanchion L-flanges into the plywood base.
- **Cord & Cushioning:** Non-stretch braided Dacron/nylon cord (`~250 mm` drive cord + `~300 mm` rear trigger string) and `3 mm` adhesive rubber/foam strip on the CoP stop sleeve and front bail landing pad.
