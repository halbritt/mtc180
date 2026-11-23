# MTC-180 v5.1 (Floor-Flush): Left/Right Pivot & CoP-Stop Stanchions + Stop Sleeve + M4 Roller + Gravity Ratchet Sear
# Zero rubber bands, 100% M4 hardware, zero supports on Bambu Lab H2S.

XP = -96.0
ZP = 72.0
XR = 48.0
ZR = 43.0
XS = -116.0
ZS = 33.0
T_BOARD = 18.0
Y_CHEEK = 10.20   # 20.4 mm inner gap between stanchions clears the 12 mm arm + through-bolted M4 nut & washer
# Quick-pin CoP stop holes by launch elevation (42/50/58 deg; horn reaches dead centre at 53.5 deg arm / 36.5 deg elev)
STOP_HOLES = {42: (-120.9, 134.1), 50: (-131.8, 129.8), 58: (-142.0, 124.1)}


def _teardrop_yz(sk, cy, cz, r):
    s = r * 0.7071
    return sk.polygon([
        (cy, cz + r * 1.414), (cy + s, cz + s), (cy + r, cz), (cy + s, cz - s),
        (cy, cz - r), (cy - s, cz - s), (cy - r, cz), (cy - s, cz + s),
    ])


def build_stanchion_cheek(side=1, name="stanchion_cheek"):
    s = 1.0 if side >= 0 else -1.0
    poly = [
        (s * -158.0, 0.0), (s * 58.0, 0.0), (s * 58.0, 34.0), (s * 34.0, 34.0),
        (s * -24.0, 46.0), (s * -98.0, 148.0), (s * -152.0, 136.0), (s * -140.0, 56.0), (s * -158.0, 38.0),
    ]
    w1 = [(s * -18.0, 12.0), (s * 26.0, 12.0), (s * 26.0, 22.0), (s * -18.0, 30.0)]
    w2 = [(s * -84.0, 12.0), (s * -38.0, 12.0), (s * -62.0, 56.0), (s * -84.0, 38.0)]
    w3 = [(s * -122.0, 72.0), (s * -98.0, 72.0), (s * -106.0, 116.0), (s * -126.0, 108.0)]
    if s < 0.0:
        poly, w1, w2, w3 = list(reversed(poly)), list(reversed(w1)), list(reversed(w2)), list(reversed(w3))
    sk = (
        sketch(XY, name=name + "_sk")
        .polygon(poly).polygon(w1).polygon(w2).polygon(w3)
        .circle(2.10, center=(s * XP, ZP - T_BOARD))
        .circle(2.10, center=(s * XR, ZR - T_BOARD))
        .circle(2.10, center=(s * XS, ZS - T_BOARD))
        .circle(2.20, center=(s * -150.0, 27.0))
    )
    for hx, hz in STOP_HOLES.values():
        sk = sk.circle(2.10, center=(s * hx, hz))
    plate = extrude(sk, 9.0, name=name + "_plate")
    flange = box(216.0, 5.5, 22.0, at=(-158.0 if s > 0 else -58.0, 0.0, 0.0), name=name + "_flange")
    cuts = [
        extrude(_teardrop_yz(sketch(XZ.offset(-6.5), name=name + "_td_" + str(i)), s * xk, 15.5, 2.10), 8.0, name=name + "_bh_" + str(i))
        for i, xk in enumerate([-142.0, -56.0, 18.0])
    ]
    cheek = subtract([union([plate, flange], kernel=kernel.mesh, name=name + "_u")] + cuts, kernel=kernel.mesh, name=name)
    cheek.material(preset=preset.petg_glossy, color="#0086D6", roughness=0.34)
    return cheek


def build_trigger_and_rollers(prefix="st"):
    # 1) Cylindrical CoP Stop Sleeve (Ø14.4 mm PETG core + 2.8 mm rubber wrap = Ø20.0 mm OD, 19.8 mm wide for 20.4 mm gap)
    stop_sk = sketch(XY, name=prefix + "_ss_sk").circle(7.20).circle(2.15)
    stop_sleeve = extrude(stop_sk, 19.8, name=prefix + "_stop_sleeve")
    stop_sleeve.material(preset=preset.petg_glossy, color="#0086D6", roughness=0.34)

    # 2) Free-spinning M4 Cord Roller Sheave (Ø14.4 mm rims, Ø11.8 mm 45-deg V-waist, 19.4 mm wide)
    rl_b = loft([sketch(XY.offset(0.0), name=prefix + "_r0").circle(7.2).circle(2.15), sketch(XY.offset(8.4), name=prefix + "_r1").circle(7.2).circle(2.15)], ruled=True, name=prefix + "_rb")
    rl_v1 = loft([sketch(XY.offset(8.4), name=prefix + "_r2").circle(7.2).circle(2.15), sketch(XY.offset(9.7), name=prefix + "_r3").circle(5.9).circle(2.15)], ruled=True, name=prefix + "_rv1")
    rl_v2 = loft([sketch(XY.offset(9.7), name=prefix + "_r4").circle(5.9).circle(2.15), sketch(XY.offset(11.0), name=prefix + "_r5").circle(7.2).circle(2.15)], ruled=True, name=prefix + "_rv2")
    rl_t = loft([sketch(XY.offset(11.0), name=prefix + "_r6").circle(7.2).circle(2.15), sketch(XY.offset(19.4), name=prefix + "_r7").circle(7.2).circle(2.15)], ruled=True, name=prefix + "_rt")
    roller = union([rl_b, rl_v1, rl_v2, rl_t], kernel=kernel.mesh, name=prefix + "_cord_roller")
    roller.material(preset=preset.petg_glossy, color="#FCE300", roughness=0.30)

    # 3) Gravity-Counterweighted Ratchet Sear Pawl (zero rubber bands; sleek top nose clears adjacent ramps across all 6 notches)
    pawl_sk = (
        sketch(XY, name=prefix + "_pw_sk")
        .polygon([
            (-34.0, -11.5), (-4.0, -11.5), (15.0, -2.5), (20.8, 0.5),
            (20.0, 4.4), (18.6, 4.2), (15.8, 0.6), (0.0, 4.8), (-10.0, 3.5), (-34.0, -2.5),
        ])
        .circle(2.10, center=(0.0, 0.0))
        .circle(1.85, center=(-28.5, -6.5))
    )
    pawl = extrude(pawl_sk, 14.0, name=prefix + "_gravity_sear")
    pawl.material(preset=preset.petg_glossy, color="#FCE300", roughness=0.32)
    return stop_sleeve, roller, pawl
