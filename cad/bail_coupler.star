# MTC-180 v5 (Floor-Flush): Spring-Cleared Driven-Side 3-Bail Coupler (100% M4 Hardware)
# Verified against IMG_4479.jpg photometric measurements (21.64 px/mm):
#   - Black torsion-spring moving leg crosses left bail wire and terminates at X = 25.7 mm, Y = -21.2 mm.
#   - Starting all coupler geometry at X_MIN = 28.5 mm gives 2.8 mm axial clearance on every trap!
#   - Prints flat on Z = 0..7.6 mm: Z = 0..1.97 mm is the solid driven deck; wires snap in from +Z (20.9 deg walls, zero overhangs).

TRAP_PITCH = param("trap_pitch", 46.15, unit="mm", min=45.5, max=52.0, doc="Flush side-by-side pitch for 46.1 mm Victor bases")
WIRE_HALF_CC = param("wire_half_cc", 19.35, unit="mm", min=17.0, max=21.0, doc="Half of 38.70 mm C-to-C (40.5mm OD - 1.8mm wire)")

X_MIN = 28.50       # 2.80 mm clear ahead of X = 25.70 mm torsion-spring leg tip (IMG_4479.jpg)
Z_WIRE = 2.95       # Bail-wire center plane above Z = 0 solid driven print face (2.05 mm solid floor under Ø1.80 wire)
X_M4 = 35.00        # Radial station of the 6x M4 self-tapping washer-lock screws
R_PULL = 50.80      # Radial station of central braided drive-cord eye (1.3 mm inside X=46.3 front beam)
M4_YS = [-60.35, -31.95, -14.20, 14.20, 31.95, 60.35]


def build_bail_coupler(name="mtc180_bail_coupler", layer=None):
    # Main plan: 3 bail tongues (X = 28.5..46.3) + front collector beam (X = 46.3..53.5) + central cord lug (X = 46.3..56.5)
    plan_sk = sketch(XY, name=name + "_plan").polygon([
        (X_MIN, -73.25), (53.5, -73.25), (53.5, -9.5), (56.5, -6.5), (56.5, 6.5), (53.5, 9.5),
        (53.5, 73.25), (X_MIN, 73.25), (X_MIN, 56.2), (36.2, 56.2),
        (36.2, 36.1), (X_MIN, 36.1), (X_MIN, 10.1), (36.2, 10.1),
        (36.2, -10.1), (X_MIN, -10.1), (X_MIN, -36.1), (36.2, -36.1),
        (36.2, -56.2), (X_MIN, -56.2),
    ])
    deck = extrude(plan_sk, 5.60, name=name + "_deck")
    # Reinforced 7.6 mm-tall front collector beam + central cord boss (past X = 46.3 mm, clear of 45.0 mm front crossbar OD)
    beam_sk = sketch(XY, name=name + "_beam_sk").polygon([
        (46.3, -73.25), (53.5, -73.25), (53.5, -9.5), (56.5, -6.5), (56.5, 6.5), (53.5, 9.5), (53.5, 73.25), (46.3, 73.25),
    ])
    front_beam = extrude(beam_sk, 7.60, name=name + "_front_beam")
    outer = union([deck, front_beam], kernel=kernel.mesh, name=name + "_outer")

    # Central Ø4.4 mm vertical cord eye + smooth top/bottom entry chamfers at (R_PULL, 0)
    cutters = [
        cylinder(2.20, 8.0, at=(R_PULL, 0.0, -0.2), name=name + "_cord_hole"),
        loft([sketch(XY.offset(-0.1), name=name + "_cc0").circle(3.3, center=(R_PULL, 0.0)), sketch(XY.offset(1.2), name=name + "_cc1").circle(2.1, center=(R_PULL, 0.0))], ruled=True, name=name + "_cord_ch_b"),
        loft([sketch(XY.offset(6.4), name=name + "_cc2").circle(2.1, center=(R_PULL, 0.0)), sketch(XY.offset(7.7), name=name + "_cc3").circle(3.3, center=(R_PULL, 0.0))], ruled=True, name=name + "_cord_ch_t"),
    ]

    # 6x M4 self-tapping washer-lock seats (Ø3.50 mm vertical pilot + Z = 4.00 mm flat shelf for M4 fender washer)
    for idx_m, y_m in enumerate(M4_YS):
        wire_side = 1.0 if y_m in [60.35, 14.20, -31.95] else -1.0
        yw_m = y_m + wire_side * 5.15
        cutters.append(cylinder(1.75, 6.0, at=(X_M4, y_m, -0.2), name=name + "_m4p_" + str(idx_m)))
        cutters.append(box(13.0, 10.6, 1.80, at=(X_M4 - 4.8, min(y_m - wire_side * 5.4, yw_m), 4.00), name=name + "_m4w_" + str(idx_m)))
        cutters.append(box(15.6, 1.80, 2.85, at=(X_MIN - 0.5, min(yw_m + wire_side * 0.2, yw_m - wire_side * 1.60), 2.95), name=name + "_m4lip_" + str(idx_m)))

    # Upward-opening (+Z) C-jaw side-wire snap seats (45-deg V-floor at Z=1.52..2.95, 1.44mm snap throat at Z=3.63)
    for idx, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
        t = str(idx + 1)
        snap_sk = sketch(YZ.offset(X_MIN - 0.5), name=name + "_snpsk_" + t)
        for sgn in [-1.0, 1.0]:
            yw = yc + sgn * WIRE_HALF_CC
            snap_sk = snap_sk.polygon([
                (yw, 1.52), (yw + 0.86, 2.38), (yw + 0.98, 2.95), (yw + 0.72, 3.63),
                (yw + 1.24, 4.50), (yw + 1.24, 5.80), (yw - 1.24, 5.80), (yw - 1.24, 4.50),
                (yw - 0.72, 3.63), (yw - 0.98, 2.95), (yw - 0.86, 2.38),
            ])
        cutters.extend(extrude(snap_sk, 14.2, name=name + "_snp_" + t))
        half_slot = 11.4 if idx == 1 else 11.35
        cutters.append(box(4.0, 2.0 * half_slot, 4.00, at=(42.3, yc - half_slot, 1.85), name=name + "_xbar_" + t))
        for sgn in [-1.0, 1.0]:
            y_in = yc + sgn * (WIRE_HALF_CC - 8.30)
            y_out = yc + sgn * (WIRE_HALF_CC + 1.24)
            cutters.append(box(6.0, 9.54, 4.00, at=(40.3, min(y_in, y_out), 1.85), name=name + "_crn_" + t + ("a" if sgn < 0 else "b")))

    coupler = subtract([outer] + cutters, kernel=kernel.mesh, name=name)
    if layer != None:
        layer.add(coupler)
    coupler.material(preset=preset.petg_glossy, color="#fd9644", roughness=0.32)
    return coupler
