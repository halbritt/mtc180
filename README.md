# MTC-180 (`MTC-180L-PL`) — 3-Mousetrap 180° Golf-Ball Carrier

![Complete MTC-180 Launch Sequence (Rear Pull-String -> Front Coaxial Sear -> 180° Sweep -> Golf Ball Trajectory)](docs/images/mtc180_full_mechanism_launch.gif)

Parametric [Cadpole](https://github.com/halbritt/cadpole) CAD and [CalculiX 2.23](http://www.dhondt.de/) `C3D8I` two-phase FDM PETG finite-element model for a single 3D-printed carrier that attaches directly to three stripped mousetrap U-bails (torsion springs + U-bails only; factory bait pedals and trigger hold-down wires removed) and carries a regulation golf ball (`Ø42.67 mm`, `45.93 g`) from parallel-cocked (`+180°`) to snapped-shut (`-3.37°` against the flat wood bases, `183.37°` total sweep). Mousetrap bases mount dead flat (`0.00°`) to the adjustable trajectory board ($\gamma_{\text{launch}} = 93.37^\circ - \beta_{\text{horiz}}$).

## Caliper-Measured Hardware Inputs

| Parameter | Caliper Value | Derived CAD Geometry |
| --- | --- | --- |
| Mousetrap base | `46.1 mm` W × `98.4 mm` L (`8.0 mm` thick) | `TRAP_PITCH = 46.15 mm` flush side-by-side (`138.3 mm` 3-trap pack) |
| U-bail wire diameter | `Ø1.80 mm` steel | Octagonal `Ø1.96 mm` wire seat + `1.44 mm` C-jaw snap throat |
| U-bail width (OD) | `40.50 mm` outside-to-outside | **`38.70 mm` center-to-center** (`WIRE_HALF_CC = 19.35 mm`) |
| U-bail length | `43.20 mm` axle to inside of front wire | Front wire spans `X = 43.20..45.00 mm` (`44.10 mm` centerline) |

## Bail Attachment (v4: wires bear on the driven side)

All factory trigger parts (bait pedal/"catch", hold-down bar, and rear staple) are stripped off, keeping only the torsion springs and U-bails. The carrier's `+Z` face leads the swing, so the springs push the wires toward `+Z`. In v4 the wire seats open on the trailing bed face (`Z = 0`) and close with a solid 45° V roof, so drive torque goes straight into the `6.2 mm` plate. The snap lips and screws only keep the wires seated.

1. **Blind Crossbar Pockets (`X = 42.3..47.5 mm`):** Each front transverse wire (`X = 43.2..45.0 mm`) sits in a blind pocket whose bridged roof is at `Z = 4.4 mm`, `0.45 mm` clear of the wire so PETG bridge sag cannot stop it seating. The crossbar does not carry drive torque; the `6.1 mm` web (`X = 36.2..42.3 mm`) sits inside the closed U-bail and takes the radial load.
2. **Side-Wire Snap Seats (`X = 19.5..28.8 mm`):** Six `38.70 mm` C-to-C seats. Each wire enters from the trailing face, passes the `1.44 mm` throat at `Z = 2.38 mm` and seats at `Z = 3.05 mm` (same plane as v3, so the sear and D-loop geometry are unchanged).
3. **Recessed M3 Washer Locks (`X = 25.8 mm`):** Six `2.05 mm`-deep pockets on the trailing face (`Y = ±15.0, ±31.15, ±61.15 mm`) take an `M3 × 6 mm` wafer or ultra-low-head screw (head `≤ 1.0 mm`) and a `9 × 0.8 mm` M3 fender washer, driven into a `2.5 mm` square self-tapping pilot. The washer laps `1.05 mm` under the wire and sits `0.10 mm` below it, so a seated wire cannot come back out. Head and washer end `0.25 mm` below the face, which matters because the cocked carrier is only `0.45 mm` off the trap wood. Over each pocket the washer replaces the near-side snap lip.

**Assembly order changed:** the carrier now goes on from the front of the bails. Lay the carrier trailing-face-up, lift each bail a few degrees, press its wires into the seats (the spring preload holds them there), fit the six washers, then screw the three trap bases to the board.

**Refit the coupon before printing the full arm.** The plan dimensions of the seats are the ones the v3 coupon verified, but the wires now enter from the opposite face, so `exports/mtc180_crossbar_fit_coupon*` needs one more print and a loaded test: snap it on, then pull the coupon against the springs by hand.

4. **Wood-Board Front Coaxial Sear + Rear Pull-String Trigger (`cad/trigger_mechanism.star`):**
   - **Recommended Trajectory Board:** `300 mm` long × `204 mm` wide × `12–19 mm` thick wood (`x_L = -190..+110 mm`), with the three stripped mousetrap bases screwed side-by-side at `x_L = -49.2..+49.2 mm`. The cup passes behind the `+110 mm` rear edge.
   - **Printed Stop Block + Pad (`x_L ≈ 97..109 mm`, `|Y| ≤ 33 mm`, kit part #4):** A `12 × 66 mm` PETG riser, `5.1 → 6.2 mm` tall with its top tilted `5°` to match the arm, screwed to the board extension with `2×` `#6` pan-head wood screws in counterbores, and a `3 mm` stick-on rubber or foam pad on top. It catches the three truss ribs at `X = 102 mm`, close to the arm's centre of percussion (`≈109 mm`), and stops the arm with the bail `5°` above the board plane, `8.4°` before the front wires would reach the flat trap wood. That keeps `175°` of the stroke, gives up a few percent of the energy at the low-torque end, and keeps the stop shock out of the bails, staples and seats. `launch_deg` in `cad/installed_positivelock.star` is the true launch elevation at this stop; the assembly test fails if `stop_deg` is set too low for the block to fit.
   - **Safety-Pin Yoke:** The sear bridge now carries two posts that straddle the cocked D-loop tongue. Slide a `4 mm` pin (bolt or nail) through both posts before loading the ball; it passes `0.5 mm` over the tongue and holds the arm even if the sear lets go. Pull it out sideways as the last step before pulling the string.
   - **Front Self-Cocking Sear (`x_L = -177.2 mm`, `Y = 0`):** Screws to the underside of the wood board (`z_L = -11.5 mm`) and hooks the carrier's distal D-loop (`X_p = 175.5..180.5 mm`, `R = 177 mm` lever arm → only `12.3 N` hold load for all 3 springs combined). Contact sits `0.35 mm` over-center against a forward positive stop so vibration cannot trip it, while a `42°` bottom cam ramp clicks shut automatically when cocking the arm by hand.
   - **Outboard Pull-String Corridor (`Y = +83.0 mm`):** A rigid `94.4 mm` coaxial PETG rocker shaft (`0.04 mm` twist under load) transfers motion outboard to `Y = +83.0 mm` (`9.75 mm` clear of the `±73.25 mm` carrier and `13.85 mm` clear of the mousetrap pack), where a `22.0 mm` lever arm (`2.5:1` mechanical advantage → **`1.8 N` / `0.41 lbf` string pull**) connects straight back under the board to the rear fairlead (`x_L = +38 mm, Y = +83 mm`) with zero pulleys and zero holes through the wood board.

## Repository Layout

- `cad/carrier_positivelock.star` — Parametric `MTC-180L-PL` v4.1 carrier solid (`arm_radius`, `trap_pitch`, `wire_half_cc`) with driven-side wire seats, sag-safe `Z = 4.4 mm` crossbar pockets, cup backstop wall and integrated distal sear D-loop.
- `cad/trigger_mechanism.star` & `cad/print_trigger.star` — Zero-support 4-part kit: Wood-Board Front Coaxial Sear + Rear Pull-String Fairlead + CoP Arm Stop Block (`29.22 cm³` CAD / `~28 g` PETG).
- `cad/print_positivelock.star` — Full-carrier export, Bambu Lab H2S `0.4` / `0.6 TC` / `0.8 TC` printability test, and a load-path test that every wire has solid plate ahead of it.
- `cad/installed_positivelock.star` — 9-pose sweep (`180°` cocked to the `5°` stop) + trigger actuation + ball flight clearance & animation model, including the stop block, safety pin and washer screws.
- `cad/crossbar_coupon.star` — Fast `40.5 × 146.5 × 8.2 mm` (`X = 19.5..60.0 mm`, `26.68 cm³` CAD / `~23 g` PETG) 1:1 bail-fit verification coupon (the v3 seats were test-fit on traps; print the v4.1 coupon first to verify the inverted driven-side snap).
- `fea/` — Deterministic STL-to-`C3D8I` brick mesher and CalculiX 2.23 two-phase FDM (`PETG_SHELL` + `PETG_GYROID15`) 4-case solver (`mise run fea`).
- `exports/` — Ready-to-slice Bambu H2S `.3mf`, `.stl`, animated `.gif`, and dimensioned A3 `.pdf` / `.svg` drawings.
- `docs/` — Detailed design notes, ballistics table, and renders.

## Verification & Export Commands

```sh
mise trust && mise run test     # Run all Cadpole printability + 9-pose clearance checks
mise run export                 # Rebuild exports/*.stl, *.3mf, *.pdf, *.svg
mise run animate                # Rebuild 64-frame full-mechanism + ball launch animated GIF
mise run fea                    # Run CalculiX 2.23 C3D8I two-phase FDM stress & inertia study
```

## Cup Backstop

The radial (centrifugal) load on the ball reaches about `20 N` late in the swing, far more than the static axial detent. v4.1 keeps a rigid outboard wall segment (`±33°`, up to `Z = 27 mm`, `4 mm` above the ball equator) with no detent lip, separated from the two compliant side petals by `2.4 mm` slits. The ball leans on that wall during the swing and slides straight out along it at the stop.

## Performance & CalculiX 2.23 `C3D8I` FEA (`v4.1`, `42,431` + `29,826` bricks)

With the repo's `2.12 J` delivered-energy assumption (`175°` active stroke to the `5.03°` stop), the `v4.1` carrier (`73.23 cm³` CAD, `60–64 g` PETG, $I_{\text{arm}} = 5.96\text{ kg·cm}^2$) gives $v_0 \approx 7.45\text{ m/s}$ (`~5.9 m` range at `42°` launch elevation, nearly twice the `3.0 m` target). Measure actual bail force at `0°`, `90°`, and `180°` with a luggage scale to pin down spring energy on your traps.

| Load Case (`mise run fea`) | Key Result (`MTC-180L-PL` v4.1, Two-Phase FDM PETG) |
| --- | --- |
| **LC1: Launch (`25 N` axial `-Z` + `20 N` radial `+X` backstop)** | $U_{\max} = 2.73\text{ mm}$, $\sigma_{\text{VM},99.8\%} = 5.26\text{ MPa}$ |
| **LC2: CoP Stop Block (`X = 102 mm` + `3 mm` rubber pad, `430 N/mm`)** | $\sigma_{\text{VM},99.8\%} = 24.94\text{ MPa}$, interlayer $\sigma_{zz,99.8\%} = 6.92\text{ MPa}$; **pad takes `657 N` while all 3 hinges combined see only `87 N` (`~29 N/trap`, `-87%` shock)** |
| **LC3: `180°` Cocked Standby on Distal D-Loop (`1.95 N·m` preload)** | $\sigma_{\text{VM},99.8\%} = 2.25\text{ MPa}$, sear hold load `10–12 N` |
| **LC4: `0.385 mm` Compliant Side-Petal Snap (`0.95 mm` cup mesh)** | $\sigma_{\text{VM},99.8\%} = 15.65\text{ MPa}$ (`0.025 J` snap energy vs. `>700 N` stop ejection inertia) |

## Bambu Lab H2S Print Settings (PETG, Supports OFF, Arachne ON, 15% Gyroid)

Add a height-range modifier at `Z = 18.0..32.0 mm` (`3` walls on `.6/.8 TC`, `5` walls on `.4 HF`) on the full carrier so the `2.65 mm` compliant ball-retention petals print solid:

| Part (`exports/*_h2s.3mf`) | Recommended Nozzle | Layer × Width | PETG Mass | Extrusion Time (`+~5.5 min` H2S prep) |
| --- | --- | --- | --- | --- |
| **1. Crossbar Fit Coupon (`v4.1`, `26.7 cm³`)** | `0.6 mm` TC or `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | `~23–24 g` | `~10 min` |
| **2. 4-Part Trigger + Stop-Block Kit (`29.2 cm³`)** | `0.6 mm` TC or `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | `~28 g` | `~12 min` |
| **3. Full Carrier (`MTC-180L-PL` v4.1, `73.2 cm³`)** | `0.6 mm` TC / `0.8 mm` TC (Sprint) | `0.40 × 0.88 mm` (`2` / `3` walls) | `~60–64 g` | `~27–28 min` |
| **3b. Full Carrier (`MTC-180L-PL` v4.1, `73.2 cm³`)** | `0.4 mm` HF | `0.28 × 0.56 mm` (`3` / `5` walls) | `~60 g` | `~33 min` |

## Hardware / Fastener Notes (M4 vs. M3)

- **Trigger Kit (`mtc180_trigger_kit`) — Uses M4 Hardware Directly:** `2×` `M4 × 35 mm` bolts/pins for the two coaxial clevis pivots (`Ø4.1–4.2 mm` teardrop bores), `1×` `M4 × 50 mm` bolt or `Ø4 mm` nail as the safety pin, `6×` `M4` or `#6` wood screws (`Ø4.1 mm` mounting holes) into the `300 × 204 × 12–19 mm` wood trajectory board, `1×` `#19`/`#32` rubber band for auto-click return, and braided nylon/Dacron pull cord.
- **Carrier Washer Locks (`X = 25.8 mm`) — `6×` `M3 × 6 mm` wafer / ultra-low-head screws (head `≤ 1.0 mm`) + `6×` `9 × 0.8 mm` M3 fender washers:** They sit fully recessed in pockets on the trailing face and only retain the wires. A standard button head (`1.65 mm`) would stand proud and touch the trap wood at full cock. The first turn of each screw cuts through a one-layer bridging step at the pocket roof. Stop when the washer seats; these are self-tapped PETG threads. For first test shots the far-side snap lips and the spring preload hold the wires without any screws; fit the washers before repeated use.
