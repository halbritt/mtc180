# MTC-180 v5 (Floor-Flush): Left/Right Pivot & CoP-Stop Stanchions + Stop Sleeve + M4 Roller + Gravity Ratchet Sear
# Zero rubber bands, 100% M4 hardware, zero supports on Bambu Lab H2S.

XP = -86.0
ZP = 72.0
XR = 34.0
ZR = 39.0
XS = -106.0
ZS = 33.0
T_BOARD = 18.0
# Stop-pin holes by launch elevation.  There is no 34-deg hole: the cord horn reaches dead centre at an arm
# angle of 50 deg (40 deg elevation), so a later stop would let the arm pull the bails back up.
STOP_HOLES = {42: (-114.0, 135.9), 50: (-125.1, 131.2)}


def _teardrop_yz(sk, cy, cz, r):
    s = r * 0.7071
    return sk.polygon([
        (cy, cz + r * 1.414), (cy + s, cz + s), (cy + r, cz), (cy + s, cz - s),
        (cy, cz - r), (cy - s, cz - s), (cy - r, cz), (cy - s, cz + s),
    ])


def build_stanchion_cheek(side=1, name="stanchion_cheek"):
    # Printed flat on Z_print = 0 (outer face of cheek); sgn = +1 for Left (+Y) cheek, -1 mirrored in X for Right (-Y) cheek
    s = 1.0 if side >= 0 else -1.0
    poly = [
        (s * -148.0, 0.0), (s * 46.0, 0.0), (s * 46.0, 31.0), (s * 22.0, 31.0),
        (s * -28.0, 44.0), (s * -90.0, 150.0), (s * -136.0, 144.0), (s * -122.0, 56.0), (s * -148.0, 38.0),
    ]
    w1 = [(s * -20.0, 12.0), (s * 16.0, 12.0), (s * 16.0, 22.0), (s * -20.0, 28.0)]
    w2 = [(s * -76.0, 12.0), (s * -38.0, 12.0), (s * -58.0, 54.0), (s * -76.0, 38.0)]
    w3 = [(s * -112.0, 72.0), (s * -90.0, 72.0), (s * -98.0, 118.0), (s * -116.0, 112.0)]
    if s < 0.0:
        poly, w1, w2, w3 = list(reversed(poly)), list(reversed(w1)), list(reversed(w2)), list(reversed(w3))
    sk = (
        sketch(XY, name=name + "_sk")
        .polygon(poly).polygon(w1).polygon(w2).polygon(w3)
        .circle(2.10, center=(s * XP, ZP - T_BOARD))
        .circle(2.10, center=(s * XR, ZR - T_BOARD))
        .circle(2.10, center=(s * XS, ZS - T_BOARD))
        .circle(2.20, center=(s * -140.0, 27.0))
    )
    for hx, hz in STOP_HOLES.values():
        sk = sk.circle(2.10, center=(s * hx, hz))
    plate = extrude(sk, 9.0, name=name + "_plate")
    # Outboard mounting L-flange along bottom edge y_sk = 0..5.5 mm extending Z_print = 0..22.0 mm (vertical wall -> 0 overhang!)
    flange = box(194.0, 5.5, 22.0, at=(-148.0 if s > 0 else -46.0, 0.0, 0.0), name=name + "_flange")
    cuts = [
        extrude(_teardrop_yz(sketch(XZ.offset(-6.5), name=name + "_td_" + str(i)), s * xk, 15.5, 2.10), 8.0, name=name + "_bh_" + str(i))
        for i, xk in enumerate([-132.0, -56.0, 8.0])
    ]
    cheek = subtract([union([plate, flange], kernel=kernel.mesh, name=name + "_u")] + cuts, kernel=kernel.mesh, name=name)
    cheek.material(preset=preset.petg_glossy, color="#0984e3", roughness=0.34)
    return cheek


def build_trigger_and_rollers(prefix="st"):
    # 1) Cylindrical CoP Stop Sleeve (Ø14.4 mm PETG core + 3 mm rubber wrap = Ø20.4 mm OD, 15.4 mm wide for 16 mm stanchion gap)
    stop_sk = sketch(XY, name=prefix + "_ss_sk").circle(7.20).circle(2.15)
    stop_sleeve = extrude(stop_sk, 15.4, name=prefix + "_stop_sleeve")
    stop_sleeve.material(preset=preset.petg_glossy, color="#0984e3", roughness=0.34)

    # 2) Free-spinning M4 Cord Roller Sheave (Ø14.4 mm rims, Ø11.8 mm 45-deg V-waist, 15.0 mm wide)
    rl_b = loft([sketch(XY.offset(0.0), name=prefix + "_r0").circle(7.2).circle(2.15), sketch(XY.offset(6.2), name=prefix + "_r1").circle(7.2).circle(2.15)], ruled=True, name=prefix + "_rb")
    rl_v1 = loft([sketch(XY.offset(6.2), name=prefix + "_r2").circle(7.2).circle(2.15), sketch(XY.offset(7.5), name=prefix + "_r3").circle(5.9).circle(2.15)], ruled=True, name=prefix + "_rv1")
    rl_v2 = loft([sketch(XY.offset(7.5), name=prefix + "_r4").circle(5.9).circle(2.15), sketch(XY.offset(8.8), name=prefix + "_r5").circle(7.2).circle(2.15)], ruled=True, name=prefix + "_rv2")
    rl_t = loft([sketch(XY.offset(8.8), name=prefix + "_r6").circle(7.2).circle(2.15), sketch(XY.offset(15.0), name=prefix + "_r7").circle(7.2).circle(2.15)], ruled=True, name=prefix + "_rt")
    roller = union([rl_b, rl_v1, rl_v2, rl_t], kernel=kernel.mesh, name=prefix + "_cord_roller")
    roller.material(preset=preset.petg_glossy, color="#fdcb6e", roughness=0.30)

    # 3) Gravity-Counterweighted Ratchet Sear Pawl (zero rubber bands! Heavy -X tail tips +X tooth UP into 6-notch quadrant!)
    pawl_sk = (
        sketch(XY, name=prefix + "_pw_sk")
        .polygon([
            (-34.0, -11.5), (-4.0, -11.5), (15.0, -2.5), (20.8, 0.5),
            (20.0, 4.8), (16.8, 4.8), (14.5, 1.0), (0.0, 4.6), (-10.0, 3.2), (-34.0, -2.5),
        ])
        .circle(2.10, center=(0.0, 0.0))
        .circle(1.85, center=(-28.5, -6.5))
    )
    pawl = extrude(pawl_sk, 12.0, name=prefix + "_gravity_sear")
    pawl.material(preset=preset.petg_glossy, color="#fdcb6e", roughness=0.32)
    return stop_sleeve, roller, pawl
