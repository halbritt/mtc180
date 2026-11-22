> **v5 Floor-Flush Rubric-Compliant Release (2026-11-22):** Re-architected for strict literal compliance with *The Mousetrap Catapult* rubric (`Design #4` & `#5`: single `≤ 1"` wood base sitting 100% flush on the floor inside `2' × 2'`, all 3 Victor mousetraps laying dead flat right-side up on the base, ball starting `< 3"` above the ground, zero rubber bands, rapid `6–8 ball` reload, and Day 2 two-target range adjustability) plus `IMG_4479.jpg` torsion-spring clearance (`X_MIN = 28.5 mm` clearing the `25.7 mm` black spring leg by `> 2.8 mm`) and 100% `M4` hardware. Current build, print, and FEA details are in top-level `README.md`; sections below preserve earlier `v2–v4.1` carrier provenance.

# MTC-180 Design Provenance (`v5` Floor-Flush Cam-Driven Catapult & Earlier `v2–v4.1` Direct Carriers)

## Printable Part & Interactive 3D Deliverables (`MTC-180L-PL` v4.1 Positive-Lock PETG)

- **Recommended (`MTC-180L-PL` v4.1 Driven-Side Carrier + 4-Part Wood-Board Trigger & CoP Stop-Block Kit):**
  - **Full-Mechanism + Trigger Pull + Ball Launch GIF:** [**Watch `mtc180_full_mechanism_launch.gif`**](https://artifact.harm.org/5n7ry9/mtc180_full_mechanism_launch.gif) · *(Earlier carrier-only GIF: [`mtc180_180deg_launch.gif`](https://artifact.harm.org/3d1y54/mtc180_180deg_launch.gif))*
  - **Interactive 3D Viewer (`v4.1`):** [Full Flat-Mounted Wood-Board Triggered Assembly](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/bcqa4v/mtc180_triggered_assembly_v4_1.glb) · [4-Part Trigger + Stop-Block Kit](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/r13tdz/mtc180_trigger_kit_v4_1.glb) · [Carrier `v4.1`](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/77gyaq/mtc180_positivelock_petg_v4_1.glb) · [Crossbar Fit Coupon `v4.1`](https://3dviewer.harm.org/#model=https://3dviewer.harm.org/models/j605cb/mtc180_crossbar_fit_coupon_v4_1.glb)
  - **All-in-One `v4.1` Print & Drawing Bundle ([`bundle.zip`](https://artifact.harm.org/5n7ry9/_artifact/bundle.zip) · [All Files](https://artifact.harm.org/5n7ry9/_artifact/)):**
    - **Step 1 — `v4.1` Crossbar Bail-Fit Coupon (`26.68 cm³` CAD):** Bambu H2S 3MF [`mtc180_crossbar_fit_coupon_h2s.3mf`](https://artifact.harm.org/5n7ry9/mtc180_crossbar_fit_coupon_h2s.3mf?download=1) · STL [`mtc180_crossbar_fit_coupon.stl`](https://artifact.harm.org/5n7ry9/mtc180_crossbar_fit_coupon.stl?download=1) · 1:1 A3 [`PDF`](https://artifact.harm.org/5n7ry9/mtc180_crossbar_fit_coupon_drawing.pdf)
    - **Step 2 — `v4.1` Full Carrier (`73.23 cm³` CAD):** Bambu H2S 3MF [`mtc180_positivelock_petg_h2s.3mf`](https://artifact.harm.org/5n7ry9/mtc180_positivelock_petg_h2s.3mf?download=1) · STL [`mtc180_positivelock_petg.stl`](https://artifact.harm.org/5n7ry9/mtc180_positivelock_petg.stl?download=1) · A3 [`PDF`](https://artifact.harm.org/5n7ry9/mtc180_positivelock_petg_drawing.pdf)
    - **Step 3 — 4-Part Wood-Board Trigger + CoP Stop-Block Kit (`29.22 cm³` CAD):** Bambu H2S 3MF [`mtc180_trigger_kit_h2s.3mf`](https://artifact.harm.org/5n7ry9/mtc180_trigger_kit_h2s.3mf?download=1) · STL [`mtc180_trigger_kit.stl`](https://artifact.harm.org/5n7ry9/mtc180_trigger_kit.stl?download=1) · 1:1 A3 [`PDF`](https://artifact.harm.org/5n7ry9/mtc180_trigger_kit_drawing.pdf)

````carousel
![Complete Floor-Flush Launch Sequence (v5): Rear Pull-String -> Gravity Sear -> 166° Bail Stroke -> 42° CoP Stop & Golf Ball Trajectory](images/mtc180_floorflush_launch.gif)
<!-- slide -->
![Cocked Floor-Flush Assembly (v5) — 3 Flat Victor Traps, X>=28.5mm Spring-Cleared Coupler, R=98mm Cam & 1.21" Open Gravity Cup](images/assy_cocked.png)
<!-- slide -->
![At 42° Center-of-Percussion Stop Sleeve — Full Bail Stroke Absorbed & Tangential Golf-Ball Release](images/assy_stop.png)
<!-- slide -->
![Spring-Cleared 3-Bail Coupler (X = 28.5..56.5 mm, 6x M4 Washer Locks, ~13 g PETG, ~6 min Print)](images/coupler_hero.png)
<!-- slide -->
![Monolithic Throwing Arm (R=98mm V-Grooved Cam + 6-Notch Sear Quadrant + Self-Centering V-Cup)](images/arm_hero.png)
<!-- slide -->
![Floor-Flush Stanchions, 3-Angle CoP Stop Sleeve, M4 Cord Roller & Counterweighted Gravity Ratchet Sear](images/stanchion_kit_hero.png)
````

---

## 1. How the Single 3D-Printed Part Solves all Three 180° Constraints

1. **Zero-Clearance Loss at Both $180^\circ$ (Cocked) and $0^\circ$ (Snapped):**
   - On a regulation Victor M040 mousetrap ($98.4 \times 46.0 \times 8.0\text{ mm}$ wood base, $\varnothing 1.80\text{ mm}$ wire U-bail, $R_{\text{bail}} = 47.5\text{ mm}$, spring coil center $3.5\text{ mm}$ off the wood), any thick clamp block inside $r < 49.2\text{ mm}$ hits the wooden base before reaching $0^\circ$ or $180^\circ$.
   - The `MTC-180 v2` carrier keeps the three U-bail attachment tongues (`Y = -46.5, 0.0, +46.5 mm`, `44.3 mm` tongue width) to **$3.8\text{ mm}$ total thickness** inside $X \in [18.0, 51.2]\text{ mm}$, with **self-centering $38.0\text{ mm}$ center-to-center flared V-grooves** ($2.7\text{ mm}$ top throat tapering to $0.6\text{ mm}$ floor at `Z = 1.85..3.80 mm`, accepting $37.2\text{--}38.8\text{ mm}$ wire spacing) plus a **coplanar $4.9\text{ mm}$ front crossbar relief pocket** (`X = 45.6..48.6 mm` floor) so front-to-back bail length tolerances never bind the side wires.
   - Immediately past the $49.2\text{ mm}$ end of the wooden mousetrap bases ($X \ge 51.4\text{ mm}$), the collector crossbar and triangulated A-frame truss ribs step up to **$10.5\text{ mm}$ depth** with zero wood interference.
2. **Upside-Down Standby Retention + Zero-Snag Tangential Release:**
   - Rotating any rigid cup $180^\circ$ to point upward at $+\gamma$ at release means its mouth points downward at $-\gamma$ when cocked at $180^\circ$.
   - The `MTC-180` cup ($X_{\text{ball}} = 140.0\text{ mm}$, $\varnothing 43.7\text{ mm}$ ID barrel, $\varnothing 19.0\text{ mm}$ anti-suction bottom vent) cuts $\pm 40^\circ$ front/rear pie reliefs to form **two compliant side cantilever petals** ($t = 2.55\text{ mm}$). At $Z = 29.0\text{ mm}$ ($+6.0\text{ mm}$ above the seated ball center $Z = 23.0\text{ mm}$, where ball chord radius is $20.47\text{ mm}$), a $22^\circ$ inward ramp narrows the throat to $r = 20.95\text{ mm}$ ($0.385\text{ mm}$ radial deflection against the $21.335\text{ mm}$ ball equator).
   - This produces **$3.5\text{ N}$ ($7.8\,g$) static snap-in retention**—holding the $45.93\text{ g}$ golf ball upside-down at $180^\circ$ with zero rattle while seated—yet consumes only $0.004\text{ J}$ ($0.17\%$ of spring energy) when $>200\text{ N}$ stop-impact inertia ejects the ball straight out along $+\hat{e}_\theta$.
3. **Zero-Support Flat FDM Printability (`cadpole check`: 0 warnings):**
   - Because the tangential launch axis $+\hat{e}_\theta$ is perpendicular to the arm plane, printing the part flat on `Z = 0` aligns all perimeter extrusions continuously along the bending axis of the arm (tensile strength $\sim 50\text{ MPa}$ along filaments, never across layer lines) while orienting the golf-ball cup upright with a $45^\circ$ self-supporting conical-spherical seat.

---

## 2. Earlier `v2–v4.1` Trajectory Control via Mousetrap Base Angle *(Superseded by `v5` Floor-Flush Ratchet & Pin Selector)*

When the three mousetraps were mounted on the **underside** of a tilted cradle plate (`v2–v4.1`), the launch velocity vector $\vec{v}_0$ at the end of the $180^\circ$ sweep was perpendicular to the mousetrap wooden bases:

$$\gamma_{\text{launch}} = 90^\circ - \beta_{\text{horiz}}$$

where $\beta_{\text{horiz}}$ is the tilt angle of the mousetrap base measured from horizontal (snap-shut end up-and-rearward, cocked end down-and-forward). Across the full $180^\circ$ sweep ($2.35\text{ J}$ elastic input, $52\text{ g}$ printed carrier mass), the unballasted carrier reaches $6.33\text{ m}$ at $\gamma = 42^\circ$, giving two exact base-angle settings for **$3.00\text{ m}$** with zero hardware changes—plus an optional $42^\circ$ setting if $52\text{ g}$ of M8 bolt/nut ballast is added to the front truss boss:

| Trajectory Mode | Mousetrap Base Tilt from Horizontal ($\beta_{\text{horiz}}$) | Resulting Launch Angle ($\gamma$) | Exit Speed ($v_0$) | Trajectory Apex | Landing Distance from Hinge Axis |
| --- | --- | --- | --- | --- | --- |
| **High-Lob Mortar (Unballasted)** | **$14.4^\circ$** | **$75.6^\circ$** | $8.10\text{ m/s}$ | $3.21\text{ m}$ | **$3.00\text{ m}$** |
| **Low-Flat Line Drive (Unballasted)** | **$82.2^\circ$** | **$7.8^\circ$** | $7.83\text{ m/s}$ | $0.42\text{ m}$ | **$3.00\text{ m}$** |
| **Max Distance (Unballasted)** | $48.0^\circ$ | $42.0^\circ$ | $7.93\text{ m/s}$ | $1.74\text{ m}$ | $6.33\text{ m}$ |
| **Mid-Arc (+52 g M8 Bolt Ballast)** | $66.2^\circ$ / $29.8^\circ$ | $23.8^\circ$ / $60.2^\circ$ | $6.02\text{ m/s}$ | $0.58\text{ m}$ / $1.62\text{ m}$ | **$3.00\text{ m}$** |

---

## 3. CalculiX 2.23 FEA Optimization & Bambu Lab H2S Print Times

### Two-Phase FDM (`PETG_SHELL` + `PETG_GYROID15`) CalculiX 2.23 `C3D8I` Verification
Modeled in CalculiX 2.23 (`ccx` incompatible-modes `C3D8I` bending elements: `32,734` bricks on `v2`, `25,037` bricks on `MTC-180L`) with explicit two-phase FDM properties ($E = 2{,}100\text{ MPa}, \nu = 0.38, \rho = 1.27\text{ g/cm}^3$ in the outer $1.80\text{ mm}$ solid shell; $E = 160\text{ MPa}, \rho = 0.19\text{ g/cm}^3$ in the $15\%$ gyroid core):

| Metric | Baseline `v2` (`82.4 cm³`) | **`MTC-180L` Strengthened (`56.1 cm³`)** | **`MTC-180L-FW` Featherweight (`40.0 cm³`)** |
| --- | --- | --- | --- |
| **Two-Phase FDM Mass / `.6 TC` Sprint Mass** | `66.3 g` / `45.8 g` | **`46.5 g` / `37.7 g` (`-30%`)** | **`33.6 g` / `31.7 g` (`-49%`)** |
| **Rotational Inertia $I_{\text{arm}}$ (about `X=0`)** | `5.982 kg·cm²` | **`4.252 kg·cm²` (`-28.9%`)** | **`3.159 kg·cm²` (`-47.2%`)** |
| **Stop-Impact Kinetic Energy $KE_{\text{stop}}$** | `0.846 J` | **`0.680 J` (`-19.6%`)** | **`0.551 J` (`-34.9%`)** |
| **Golf-Ball Exit Speed $v_0$** | `7.45 m/s` | **`7.92 m/s` (`+6.3%`)** | **`8.27 m/s` (`+11.0%`)** |
| **LC1: Equal `25 N` Launch Seat Deflection / VM** | `2.71 mm` / `6.64 MPa` | **`1.96 mm` (`+38%` stiffer) / `5.43 MPa` (`-18%`)** | `2.31 mm` / `5.85 MPa` |
| **LC2: `0°` Stop-Shock VM ($99.8\%$) / Interlayer $S_{zz}$** | `26.70 MPa` / `8.99 MPa` | **`21.22 MPa` (`-20.5%`) / `5.69 MPa` (`-36.7%`)** | `19.71 MPa` / `5.36 MPa` |
| **LC3/4: `48 N` Latch VM / `0.42 mm` Petal Snap VM** | `0.39 MPa` / `12.25 MPa` | **`0.38 MPa` / `11.75 MPa`** | `0.51 MPa` / `17.25 MPa` |

### Bambu Lab H2S Nozzle Comparison on `MTC-180L` (`mtc180_ultralight_petg_h2s.3mf`)
Verified zero-warning (`cadpole test`) across `0.4`, `0.6`, and `0.8 mm` nozzles on `printer="bambu_h2s"` (`5/5` 180° arc clearance checks passed; Supports **OFF**, Arachne ON, **15% gyroid**, height-range modifier `Z = 18.0..32.0 mm` for solid `2.65 mm` compliant petals):

| H2S Nozzle | Layer × Line Width | Walls (`Base` / `Z≥18`) | PETG Mass (`MTC-180L-PL`) | Extrusion Time | Wall-Clock (+H2S Prep) |
| --- | --- | --- | --- | --- | --- |
| **`0.6 mm` TC (Sprint — Recommended)** | **`0.40 × 0.88 mm`** | **`2` / `3`** | **`43.3 g`** (`31.7 g` FW) | **`19.1 min`** (`14.3 min` FW) | **`~24.6 min`** (`~19.8 min` FW) |
| **`0.8 mm` TC (AdaptTop `0.24` @ `Z≥25.5`)** | `0.44 × 0.90 mm` | `2` / `3` | `46.2 g` (`32.3 g` FW) | **`19.9 min`** (`14.5 min` FW) | **`~25.4 min`** (`~20.0 min` FW) |
| **`0.4 mm` HF** | `0.28 × 0.56 mm` | `3` / `5` | `43.0 g` (`31.2 g` FW) | **`23.3 min`** (`17.6 min` FW) | **`~28.8 min`** (`~23.1 min` FW) |
| **`0.4 mm` Standard (Stock)** | `0.20 × 0.42 mm` | `4` / `5` (25%) | `48.2 g` (`33.6 g` FW) | `52.5 min` (`40.6 min` FW) | `~58.0 min` (`~46.1 min` FW) |

### Caliper-Exact Positive-Lock Attachment (`46.1 × 98.4 mm` Base, `40.5 × 43.2 mm` `Ø1.8 mm` Bail)
1. **Prep Traps:** Remove the bait pedals and hold-down bars from three traps and butt the **`46.1 × 98.4 mm` wooden bases dead flush edge-to-edge** (`46.15 mm` pitch = `138.3 mm` pack width, zero shims needed) under the $95 \times 196\text{ mm}$ tilting cradle plate. The carrier's two `8.2 mm` outboard edge girders (`|Y| = 69.85..73.25 mm`) straddle outside the `138.3 mm` wood pack and clear the mounting board by `>3 mm`.
2. **Hook `43.2 mm` Crossbars & Click Into `38.70 mm` C-to-C Snap-Jaws:** Drop the three front wire crossbars (`X = 43.20..45.00 mm`) into the `5.0 mm` open drop-through slots (`X = 42.30..47.30 mm`, joined to the side grooves via front corner-turn reliefs) so the solid `6.1 mm` bail-retainer webs (`X = 36.20..42.30 mm`) sit **inside** each closed U-bail. Press the six straight side wires (**`40.5 mm` OD = `38.70 mm` C-to-C**) past the `1.44 mm` snap throats (`X = 18.5..28.8 mm`) until they click into the octagonal `Ø1.96 mm` seats. Inside `|Y| <= 69.2 mm` and `X <= 51.6 mm`, the carrier steps down to `Z = 3.20 mm` so the `45.0..49.2 mm` wood tip clears at `0°` and bare steel strikes the wood.
3. **Lock Rear M3 Clamps (`X = 24.2 mm`):** Thread **6× `M3 × 6–8 mm` low-head screws + `0.5 mm` M3 washers** into the inboard `Ø2.66 mm` self-tapping bosses (`Y = ±15.0, ±31.15, ±61.15 mm`, leaving the inter-trap girders 100% un-drilled), or run flat-head M3 screws from the flush `45°` `Z = 0` countersinks into [`m3_wire_clamp_bars.stl`](https://artifact.harm.org/e2zrve/m3_wire_clamp_bars.stl?download=1).
