# MTC-180L-PL (v4 Caliper-Exact): Positive-Lock PETG 3-Mousetrap 180-Deg Carrier
# v4 load path: +Z is the direction of travel, so the springs push the bail wires toward +Z.
#   - Wire seats open on the trailing bed face (Z = 0) and close with a solid V roof on the leading side:
#     drive torque goes straight into plastic; the snap lips and M3 washers only retain the wires.
#   - Front crossbars sit in blind pockets whose bridged roof (Z = 4.4) clears the wire by 0.45 mm for sag.
#   - The three truss ribs at X_STRIKE meet a padded stop block near the arm's centre of percussion (no added mass).
#   - Cup has a rigid outboard backstop wall (no detent lip) that takes the radial ball load.
# Exact User Trap Measurements:
#   - Trap wood base: 46.1 mm wide x 98.4 mm long (TRAP_PITCH = 46.2 mm side-by-side)
#   - Bail wire: Ø1.80 mm, 40.50 mm outside-to-outside -> 38.70 mm C-to-C (WIRE_HALF_CC = 19.35 mm)
#   - Bail length: 43.20 mm from axle to inside of front wire -> front wire spans X = 43.20..45.00 mm (center 44.10 mm)

L_BALL = param("arm_radius", 140.0, unit="mm", min=115.0, max=175.0, doc="Spring hinge axis (X=0) to golf ball center")
TRAP_PITCH = param("trap_pitch", 46.15, unit="mm", min=45.5, max=52.0, doc="Flush side-by-side pitch for 46.1 mm trap bases")
WIRE_HALF_CC = param("wire_half_cc", 19.35, unit="mm", min=17.0, max=21.0, doc="Half of 38.70 mm C-to-C (40.5mm OD - 1.8mm wire)")


M3_YS = [-61.15, -31.15, -15.00, 15.00, 31.15, 61.15]
T_SEAT = 6.2          # Plate thickness over the bail seats (X = 19.5..51.6)
Z_WIRE = 3.05         # Bail-wire centre plane (unchanged from v3, so sear and D-loop geometry carry over)
X_M3 = 25.8          # Radial station of the six washer-retention screws
X_STRIKE = 102.0      # Station where the truss rib tops meet the stop block (centre of percussion is ~109 mm)


def build_positivelock_carrier(name="mtc180_poslock", layer=None):
    # Outer trap wood edges at ±(46.15 + 23.05) = ±69.20 mm. Outboard girders sit at Y = ±(69.85..73.25) mm.
    m3_ys = M3_YS   # 4.35 mm inboard of each wire (v3 stations): a recessed 9 mm M3 fender washer laps 1.05 mm under the wire
    plan_sk = (
        sketch(XY, name=name + "_plan")
        .polygon([
            (19.5, -73.25), (63.2, -73.25), (67.0, -64.5),
            (132.0, -8.4), (132.0, 8.4),
            (67.0, 64.5), (63.2, 73.25), (19.5, 73.25), (19.5, 57.5), (36.2, 57.5),
            (36.2, 34.8), (19.5, 34.8), (19.5, 11.4), (36.2, 11.4),
            (36.2, -11.4), (19.5, -11.4), (19.5, -34.8), (36.2, -34.8),
            (36.2, -57.5), (19.5, -57.5),
        ])
        .polygon([(63.5, 25.0), (87.5, 2.1), (116.0, 2.1), (116.0, 16.5), (63.5, 59.0)])
        .polygon([(63.5, -25.0), (63.5, -59.0), (116.0, -16.5), (116.0, -2.1), (87.5, -2.1)])
        .polygon([(63.5, -18.0), (81.0, 0.0), (63.5, 18.0)])
    )
    for y_m in m3_ys:
        plan_sk = plan_sk.rect(3.3, 1.85, center=(34.0, y_m))
    arm_ext = extrude(plan_sk, 14.6, name=name + "_arm_ext")

    arm_ramped = subtract([
        arm_ext,
        extrude(sketch(XZ.offset(-76.0), name=name + "_tr_full").polygon([
            (18.0, T_SEAT), (51.6, T_SEAT), (60.2, 14.6), (63.0, 14.6), (63.0, 19.0), (18.0, 19.0),
        ]), 152.0, name=name + "_trim_blk"),
    ], kernel=kernel.mesh, name=name + "_arm_ramped")

    # 2. Outboard Full-Depth Edge Girders (Y = ±71.55 mm, outside 138.3mm wood pack! Z=0..8.2mm clears mounting board by >3mm!)
    ob_sk = sketch(XY, name=name + "_ob_sk").rect(40.0, 3.40, center=(39.5, -71.55)).rect(40.0, 3.40, center=(39.5, 71.55))
    ob_girders = extrude(ob_sk, 8.2, name=name + "_ob_girders")

    # 3. 2.65 mm Monocoque Conical-Spherical Cup + Flat-Bed Distal Sear D-Loop (Z = 0..4.8 mm)
    cup_outer = loft([
        sketch(XY.offset(0.0), name=name + "_co0").circle(13.2, center=(L_BALL, 0.0)),
        sketch(XY.offset(8.8), name=name + "_co1").circle(20.4, center=(L_BALL, 0.0)),
        sketch(XY.offset(17.8), name=name + "_co2").circle(24.5, center=(L_BALL, 0.0)),
        sketch(XY.offset(32.0), name=name + "_co3").circle(24.5, center=(L_BALL, 0.0)),
    ], ruled=True, name=name + "_cup_outer")
    sear_loop_sk = (
        sketch(XY, name=name + "_sear_sk")
        .polygon([
            (L_BALL + 4.0, -12.2), (L_BALL + 25.0, -13.5), (L_BALL + 40.5, -13.5),
            (L_BALL + 40.5, 13.5), (L_BALL + 25.0, 13.5), (L_BALL + 4.0, 12.2),
        ])
        .rect(9.0, 17.0, center=(L_BALL + 31.0, 0.0))
    )
    sear_loop = extrude(sear_loop_sk, 4.8, name=name + "_sear_loop")
    outer_solid = union([arm_ramped] + ob_girders + [cup_outer, sear_loop], kernel=kernel.mesh, name=name + "_outer")

    # 4. Inner Cup + Flush M3 Countersinks + Snap-Fit C-Jaws (38.70mm C-to-C) + U-Corner Turn Reliefs (X=39.5..46.8mm)!
    cav_rings = [(-1.0, 10.40), (2.5, 10.40), (11.2, 18.20), (17.5, 21.15), (22.0, 21.85), (26.8, 21.85), (29.0, 20.95), (33.0, 22.20)]
    cutters = [loft([sketch(XY.offset(z), name=name + "_cv" + str(i)).circle(r, center=(L_BALL, 0.0)) for i, (z, r) in enumerate(cav_rings)], ruled=True, name=name + "_cup_cav")]

    # Washer pockets on the trailing face. Roof at Z = 2.05 sits 0.10 mm under the wire, so a 0.8 mm fender washer
    # plus a 1.0 mm wafer head stays 0.25 mm below the face (the cocked carrier is only 0.45 mm off the trap wood).
    # Over the pocket the washer replaces the near-side snap lip; the far lip still snaps the wire in.
    for idx_m, y_m in enumerate(m3_ys):
        wire_side = 1.0 if y_m in [61.15, 15.00, -31.15] else -1.0
        yw_m = y_m + wire_side * 4.35
        cutters.append(box(9.2, 9.75, 2.15, at=(X_M3 - 4.6, min(y_m - wire_side * 5.4, yw_m), -0.1), name=name + "_wp_" + str(idx_m)))
        cutters.append(extrude(
            sketch(YZ.offset(X_M3 - 4.6), name=name + "_wl_sk_" + str(idx_m)).polygon([
                (yw_m, -0.10), (yw_m - wire_side * 1.24, -0.10), (yw_m - wire_side * 1.24, 3.05),
                (yw_m - wire_side * 0.86, 3.62), (yw_m, 3.62),
            ]),
            9.2, name=name + "_wl_" + str(idx_m),
        ))
        # Stepped bridging under the pilot: a 2.5 mm slot one layer deep splits the pocket roof into two clean
        # bridges, then a 2.5 mm square self-tapping pilot continues through the plate (no supports, no drilling).
        cutters.append(box(9.2, 2.5, 0.4, at=(X_M3 - 4.6, y_m - 1.25, 1.95), name=name + "_pslot_" + str(idx_m)))
        cutters.append(box(2.5, 2.5, 4.4, at=(X_M3 - 1.25, y_m - 1.25, 1.95), name=name + "_pilot_" + str(idx_m)))

    for idx, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
        t = str(idx + 1)
        snap_sk = sketch(YZ.offset(18.5), name=name + "_snpsk_" + t)
        open_sk = sketch(YZ.offset(28.8), name=name + "_opnsk_" + t)
        for sgn in [-1.0, 1.0]:
            yw = yc + sgn * WIRE_HALF_CC
            # Wire enters from the bed face, passes the 1.44 mm snap throat at Z = 2.38 and seats at Z = 3.05
            # against a 45-deg V roof (peak Z = 4.48), leaving 1.5 mm of solid plate on the driven side.
            snap_sk = snap_sk.polygon([
                (yw - 1.24, -0.10), (yw + 1.24, -0.10), (yw + 1.24, 1.50),
                (yw + 0.72, 2.38), (yw + 0.98, 3.05), (yw + 0.86, 3.62), (yw, 4.48),
                (yw - 0.86, 3.62), (yw - 0.98, 3.05), (yw - 0.72, 2.38), (yw - 1.24, 1.50),
            ])
            open_sk = open_sk.polygon([
                (yw - 1.24, -0.10), (yw + 1.24, -0.10), (yw + 1.24, 3.05),
                (yw + 0.86, 3.62), (yw, 4.48), (yw - 0.86, 3.62), (yw - 1.24, 3.05),
            ])
        cutters.extend(extrude(snap_sk, 10.3, name=name + "_snp_" + t))
        cutters.extend(extrude(open_sk, 18.5, name=name + "_opn_" + t))
        # Blind crossbar pocket (X = 42.3..47.5) and corner-turn reliefs (X = 40.3..47.5). The bridged roof sits at
        # Z = 4.4, 0.45 mm over the wire, so PETG bridge sag cannot stop the crossbar seating. The side wires in
        # their V seats carry the drive torque; the crossbar only locates the carrier radially.
        half_slot = 11.4 if idx == 1 else 11.35
        cutters.append(box(5.2, 2.0 * half_slot, 4.5, at=(42.3, yc - half_slot, -0.1), name=name + "_xbar_" + t))
        for sgn in [-1.0, 1.0]:
            # Outer face lands exactly on the wire-channel wall (yw +- 1.24) so the two cuts share one plane
            y_in = yc + sgn * (WIRE_HALF_CC - 8.30)
            y_out = yc + sgn * (WIRE_HALF_CC + 1.24)
            cutters.append(box(7.2, 9.54, 4.5, at=(40.3, min(y_in, y_out), -0.1), name=name + "_crn_" + t + ("a" if sgn < 0 else "b")))

    # Petal reliefs: full inboard sector, but only two 2.5 mm slits outboard so a rigid backstop wall
    # (|azimuth| < 33 deg) stays where the centrifugal load pushes the ball.
    y_slit = 30.0 * math.tan(33.0)
    sec_sk = (
        sketch(XY.offset(18.5), name=name + "_sec_sk")
        .polygon([(L_BALL, 0.0), (L_BALL + 30.0, y_slit), (L_BALL + 30.0, 24.5)])
        .polygon([(L_BALL, 0.0), (L_BALL + 30.0, -24.5), (L_BALL + 30.0, -y_slit)])
        .polygon([(L_BALL, 0.0), (L_BALL - 30.0, 24.5), (L_BALL - 30.0, -24.5)])
    )
    cutters.extend(extrude(sec_sk, 16.0, name=name + "_petal_sectors"))
    # Backstop only needs to reach 4 mm above the ball equator (Z = 23); trim the rest to save tip inertia
    cutters.append(extrude(
        sketch(XY.offset(27.0), name=name + "_bs_top_sk").polygon([(L_BALL, 0.0), (L_BALL + 30.0, -24.5), (L_BALL + 30.0, 24.5)]),
        8.0, name=name + "_backstop_trim",
    ))
    # Remove the detent lip from the backstop so the ball slides straight out along it
    lip_pts = [(L_BALL, 0.0)] + [(L_BALL + 22.0 * math.cos(a), 22.0 * math.sin(a)) for a in range(-36, 37, 3)]
    cutters.append(extrude(sketch(XY.offset(22.0), name=name + "_bs_sk").polygon(lip_pts), 12.0, name=name + "_backstop_bore"))

    carrier = subtract([outer_solid] + cutters, kernel=kernel.mesh, name=name)
    if layer != None:
        layer.add(carrier)
    carrier.material(preset=preset.petg_glossy, color="#00b894", roughness=0.32)
    return carrier
