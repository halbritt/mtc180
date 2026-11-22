# MTC-180L-PL (v3 Caliper-Exact): Positive-Lock FEA-Optimized PETG 3-Mousetrap 180-Deg Carrier
# Exact User Trap Measurements:
#   - Trap wood base: 46.1 mm wide x 98.4 mm long (TRAP_PITCH = 46.2 mm side-by-side)
#   - Bail wire: Ø1.80 mm, 40.50 mm outside-to-outside -> 38.70 mm C-to-C (WIRE_HALF_CC = 19.35 mm)
#   - Bail length: 43.20 mm from axle to inside of front wire -> front wire spans X = 43.20..45.00 mm (center 44.10 mm)

L_BALL = param("arm_radius", 140.0, unit="mm", min=115.0, max=175.0, doc="Spring hinge axis (X=0) to golf ball center")
TRAP_PITCH = param("trap_pitch", 46.15, unit="mm", min=45.5, max=52.0, doc="Flush side-by-side pitch for 46.1 mm trap bases")
WIRE_HALF_CC = param("wire_half_cc", 19.35, unit="mm", min=17.0, max=21.0, doc="Half of 38.70 mm C-to-C (40.5mm OD - 1.8mm wire)")


def build_positivelock_carrier(name="mtc180_poslock", layer=None):
    # Outer trap wood edges at ±(46.15 + 23.05) = ±69.20 mm. Outboard girders sit at Y = ±(69.85..73.25) mm.
    m3_ys = [-61.15, -31.15, -15.00, 15.00, 31.15, 61.15]   # Inboard of all 6 wires -> leaves inter-trap girders 100% un-drilled!
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
        .rect(5.0, 22.7, center=(44.8, 46.15))
        .rect(5.0, 22.8, center=(44.8, 0.0))
        .rect(5.0, 22.7, center=(44.8, -46.15))
        .polygon([(63.5, 25.0), (87.5, 2.1), (116.0, 2.1), (116.0, 16.5), (63.5, 59.0)])
        .polygon([(63.5, -25.0), (63.5, -59.0), (116.0, -16.5), (116.0, -2.1), (87.5, -2.1)])
        .polygon([(63.5, -18.0), (81.0, 0.0), (63.5, 18.0)])
    )
    for y_m in m3_ys:
        plan_sk = plan_sk.circle(1.33, center=(24.2, y_m)).rect(3.3, 1.85, center=(33.0, y_m))
    arm_ext = extrude(plan_sk, 14.6, name=name + "_arm_ext")

    arm_ramped = subtract([
        arm_ext,
        extrude(sketch(XZ.offset(-76.0), name=name + "_tr_full").polygon([
            (18.0, 4.68), (28.8, 4.68), (30.3, 3.20), (51.6, 3.20), (63.0, 14.6), (63.0, 19.0), (18.0, 19.0),
        ]), 152.0, name=name + "_trim_blk"),
    ], kernel=kernel.mesh, name=name + "_arm_ramped")

    # 2. Outboard Full-Depth Edge Girders (Y = ±71.55 mm, outside 138.3mm wood pack! Z=0..8.2mm clears mounting board by >3mm!)
    ob_sk = sketch(XY, name=name + "_ob_sk").rect(40.0, 3.40, center=(39.5, -71.55)).rect(40.0, 3.40, center=(39.5, 71.55))
    ob_girders = extrude(ob_sk, 8.2, name=name + "_ob_girders")

    # 3. 2.65 mm Monocoque Conical-Spherical Cup
    cup_outer = loft([
        sketch(XY.offset(0.0), name=name + "_co0").circle(13.2, center=(L_BALL, 0.0)),
        sketch(XY.offset(8.8), name=name + "_co1").circle(20.4, center=(L_BALL, 0.0)),
        sketch(XY.offset(17.8), name=name + "_co2").circle(24.5, center=(L_BALL, 0.0)),
        sketch(XY.offset(32.0), name=name + "_co3").circle(24.5, center=(L_BALL, 0.0)),
    ], ruled=True, name=name + "_cup_outer")
    outer_solid = union([arm_ramped] + ob_girders + [cup_outer], kernel=kernel.mesh, name=name + "_outer")

    # 4. Inner Cup + Flush M3 Countersinks + Snap-Fit C-Jaws (38.70mm C-to-C) + U-Corner Turn Reliefs (X=39.5..46.8mm)!
    cav_rings = [(-1.0, 10.40), (2.5, 10.40), (11.2, 18.20), (17.5, 21.15), (22.0, 21.85), (26.8, 21.85), (29.0, 20.95), (33.0, 22.20)]
    cutters = [loft([sketch(XY.offset(z), name=name + "_cv" + str(i)).circle(r, center=(L_BALL, 0.0)) for i, (z, r) in enumerate(cav_rings)], ruled=True, name=name + "_cup_cav")]

    for idx_m, y_m in enumerate(m3_ys):
        cutters.append(loft([
            sketch(XY.offset(-0.1), name=name + "_cs0_" + str(idx_m)).circle(2.50, center=(24.2, y_m)),
            sketch(XY.offset(1.20), name=name + "_cs1_" + str(idx_m)).circle(1.30, center=(24.2, y_m)),
        ], ruled=True, name=name + "_cs_" + str(idx_m)))

    for idx, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
        t = str(idx + 1)
        snap_sk = sketch(YZ.offset(18.5), name=name + "_snpsk_" + t)
        open_sk = sketch(YZ.offset(28.8), name=name + "_opnsk_" + t)
        for sgn in [-1.0, 1.0]:
            yw = yc + sgn * WIRE_HALF_CC
            # 1.44mm snap throat at Z=3.72 over Ø1.80mm wire seated at Z=2.15..3.95 (center Z=3.05)
            snap_sk = snap_sk.polygon([
                (yw - 0.46, 2.10), (yw + 0.46, 2.10),
                (yw + 0.86, 2.48), (yw + 0.98, 3.05), (yw + 0.72, 3.72),
                (yw + 1.24, 4.60), (yw + 1.24, 18.00),
                (yw - 1.24, 18.00), (yw - 1.24, 4.60),
                (yw - 0.72, 3.72), (yw - 0.98, 3.05), (yw - 0.86, 2.48),
            ])
            open_sk = open_sk.polygon([
                (yw - 0.46, 2.10), (yw + 0.46, 2.10),
                (yw + 0.86, 2.48), (yw + 1.24, 3.05), (yw + 1.24, 18.00),
                (yw - 1.24, 18.00), (yw - 1.24, 3.05), (yw - 0.86, 2.48),
            ])
        cutters.extend(extrude(snap_sk, 10.3, name=name + "_snp_" + t))
        cutters.extend(extrude(open_sk, 18.5, name=name + "_opn_" + t))
        # U-bail front corner-turn reliefs (X=40.1..47.5, continuously bridging side groove yw into the ±11.35mm drop-through slot!)
        c_bot = (
            sketch(XY.offset(2.08), name=name + "_cb_" + t)
            .rect(7.2, 9.5, center=(43.9, yc - WIRE_HALF_CC + 3.55))
            .rect(7.2, 9.5, center=(43.9, yc + WIRE_HALF_CC - 3.55))
        )
        c_top = (
            sketch(XY.offset(5.20), name=name + "_ct_" + t)
            .rect(7.8, 9.8, center=(43.9, yc - WIRE_HALF_CC + 3.55))
            .rect(7.8, 9.8, center=(43.9, yc + WIRE_HALF_CC - 3.55))
        )
        cutters.extend(loft([c_bot, c_top], ruled=True, name=name + "_crn_" + t))

    sec_sk = (
        sketch(XY.offset(18.5), name=name + "_sec_sk")
        .polygon([(L_BALL, 0.0), (L_BALL + 30.0, -24.5), (L_BALL + 30.0, 24.5)])
        .polygon([(L_BALL, 0.0), (L_BALL - 30.0, 24.5), (L_BALL - 30.0, -24.5)])
    )
    cutters.extend(extrude(sec_sk, 16.0, name=name + "_petal_sectors"))

    carrier = subtract([outer_solid] + cutters, kernel=kernel.mesh, name=name)
    if layer != None:
        layer.add(carrier)
    carrier.material(preset=preset.petg_glossy, color="#00b894", roughness=0.32)
    return carrier
