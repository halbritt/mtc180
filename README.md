# MTC-180 (`MTC-180L-PL`) — 3-Mousetrap 180° Golf-Ball Carrier

Parametric [Cadpole](https://github.com/halbritt/cadpole) CAD and [CalculiX 2.23](http://www.dhondt.de/) `C3D8I` two-phase FDM PETG finite-element model for a single 3D-printed carrier that attaches directly to three stripped mousetrap U-bails (torsion springs + U-bails only; factory bait pedals and trigger hold-down wires removed) and carries a regulation golf ball (`Ø42.67 mm`, `45.93 g`) through the full `180°` sweep. Launch angle is set by tilting the mousetrap mounting plane ($\gamma_{\text{launch}} = 90^\circ - \beta_{\text{horiz}}$).

## Caliper-Measured Hardware Inputs

| Parameter | Caliper Value | Derived CAD Geometry |
| --- | --- | --- |
| Mousetrap base | `46.1 mm` W × `98.4 mm` L (`8.0 mm` thick) | `TRAP_PITCH = 46.15 mm` flush side-by-side (`138.3 mm` 3-trap pack) |
| U-bail wire diameter | `Ø1.80 mm` steel | Octagonal `Ø1.96 mm` wire seat + `1.44 mm` C-jaw snap throat |
| U-bail width (OD) | `40.50 mm` outside-to-outside | **`38.70 mm` center-to-center** (`WIRE_HALF_CC = 19.35 mm`) |
| U-bail length | `43.20 mm` axle to inside of front wire | Front wire spans `X = 43.20..45.00 mm` (`44.10 mm` centerline) |

## Positive-Lock Bail Attachment (No Factory Trigger, No Zip-Ties)

All factory trigger parts (bait pedal/"catch", hold-down bar, and rear staple) are stripped off, keeping only the torsion springs and U-bails:

1. **Front Bail-Retainer Slot & Web (`X = 36.2..47.3 mm`):** Behind the front nose bar (`X > 47.3 mm`), each bail station has a `5.0 mm` through-slot (`X = 42.3..47.3 mm`) ahead of a `6.1 mm` plastic retainer web (`X = 36.2..42.3 mm`). Threading the U-bail's front transverse wire (`X = 43.2..45.0 mm`) down through the slot places the wire under the nose bar while the plastic web sits inside the closed U-bail loop, interlocking the steel bail and printed arm like two chain links.
2. **Side-Wire C-Jaws (`X = 18.5..28.8 mm`):** Six `38.70 mm` C-to-C snap jaws click over the straight `Ø1.80 mm` side wires.
3. **Rear M3 Lock (`X = 24.2 mm`):** Six inboard `Ø2.66 mm` self-tapping M3 bosses (`Y = ±15.0, ±31.15, ±61.15 mm`) accept `M3 × 6–8 mm` screws + washers (or flat-head screws from `Z = 0` into `exports/m3_wire_clamp_bars.stl`).
4. **Wood-Board Front Coaxial Sear + Rear Pull-String Trigger (`cad/trigger_mechanism.star`):**
   - **Recommended Trajectory Board:** `240 mm` long × `204 mm` wide × `12–19 mm` thick wood (`x_L = -190..+50 mm`), with the three stripped mousetrap bases screwed side-by-side at `x_L = -49.2..+49.2 mm` (flush with the rear `+50 mm` board edge so the `0°` released cup clears the back of the board).
   - **Front Self-Cocking Sear (`x_L = -177.2 mm`, `Y = 0`):** Screws to the underside of the wood board (`z_L = -11.5 mm`) and hooks the carrier's distal D-loop (`X_p = 175.5..180.5 mm`, `R = 177 mm` lever arm → only `12.3 N` hold load for all 3 springs combined). Contact sits `0.35 mm` over-center against a forward positive stop so vibration cannot trip it, while a `42°` bottom cam ramp clicks shut automatically when cocking the arm by hand.
   - **Outboard Pull-String Corridor (`Y = +83.0 mm`):** A rigid `94.4 mm` coaxial PETG rocker shaft (`0.04 mm` twist under load) transfers motion outboard to `Y = +83.0 mm` (`9.75 mm` clear of the `±73.25 mm` carrier and `13.85 mm` clear of the mousetrap pack), where a `22.0 mm` lever arm (`2.5:1` mechanical advantage → **`1.8 N` / `0.41 lbf` string pull**) connects straight back under the board to the rear fairlead (`x_L = +38 mm, Y = +83 mm`) with zero pulleys and zero holes through the wood board.

## Repository Layout

- `cad/carrier_positivelock.star` — Parametric `MTC-180L-PL` v3.1 carrier solid (`arm_radius`, `trap_pitch`, `wire_half_cc`) with integrated distal sear D-loop.
- `cad/trigger_mechanism.star` & `cad/print_trigger.star` — Zero-support 3-part Wood-Board Front Coaxial Sear + Rear Pull-String Fairlead kit (`22.96 cm³` CAD / `~17 g` PETG).
- `cad/print_positivelock.star` — Full-carrier export & Bambu Lab H2S `0.4` / `0.6 TC` / `0.8 TC` printability test.
- `cad/installed_positivelock.star` — 6-pose `180°` sweep clearance test against 3 exact bails, sloped wood bases, `240 × 204 mm` trajectory board, front coaxial sear, rear fairlead, and pull string.
- `cad/crossbar_coupon.star` — Fast `40.5 × 146.5 × 8.2 mm` (`X = 19.5..60.0 mm`) 1:1 bail-fit verification coupon (`~7–9 min` extrude on `.6/.8 TC`).
- `cad/m3_clamp_bars.star` — Optional 4-piece printed M3 wire clamp bars.
- `fea/` — Deterministic STL-to-`C3D8I` brick mesher and CalculiX 2.23 two-phase FDM (`PETG_SHELL` + `PETG_GYROID15`) 4-step solver.
- `exports/` — Ready-to-slice Bambu H2S `.3mf`, `.stl`, and dimensioned A3 `.pdf` / `.svg` drawings.
- `docs/` — Detailed design notes, ballistics table, and renders.

## Verification & Export Commands

```sh
mise trust && mise run test     # Run all Cadpole printability + 180-deg clearance checks
mise run export                 # Rebuild exports/*.stl, *.3mf, *.pdf, *.svg
mise run fea                    # Run CalculiX 2.23 C3D8I two-phase FDM stress & inertia study
```

## Bambu Lab H2S Print Settings (PETG, Supports OFF, Arachne ON, 15% Gyroid)

Add a height-range modifier at `Z = 18.0..32.0 mm` (`3` walls on `.6/.8 TC`, `5` walls on `.4 HF`) so the `2.65 mm` compliant ball-retention petals print solid:

| Part | Recommended Nozzle | Layer × Width | PETG Mass | Extrusion Time |
| --- | --- | --- | --- | --- |
| **Crossbar Fit Coupon** | `0.6 mm` TC or `0.8 mm` TC | `0.40 × 0.88 mm` (`2` walls) | `~16–18 g` | `~7–9 min` |
| **Full Carrier (`MTC-180L-PL`)** | `0.6 mm` TC (Sprint) | `0.40 × 0.88 mm` (`2` / `3` walls) | `43.3 g` | `19.1 min` |
| **Full Carrier (`MTC-180L-PL`)** | `0.4 mm` HF | `0.28 × 0.56 mm` (`3` / `5` walls) | `43.0 g` | `23.3 min` |
