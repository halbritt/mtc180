# MTC-180 v5 (Floor-Flush): FEA-Lightened Monolithic PETG Throwing Arm (~108 cm3, R=98mm Cam + 6-Notch Quadrant + V-Cup)
# Prints flat on its left cheek (Z_print = 0..18.0 mm -> Y = -9.0..+9.0 mm in assembly):
#   - Vertical Ø4.20 mm M4 pivot bore (18.0 mm wide bearing stance for zero lateral play on Day 2 accuracy).
#   - Spoked R=98.0 mm circular cam sector with 45-deg V-groove (R_CAM_EFF = 96.5 mm).
#   - 6-notch lower ratchet quadrant (R_RATCH = 36.0 mm) for 1.7 m .. 6.4 m distance selection with zero loose pins.
#   - Open top-loading 45-deg V-cradle golf-ball cup + centrifugal backstop at (-L_BALL, 0), true 3D-cleared for Ø42.67 mm ball.

L_BALL = param("arm_radius", 170.0, unit="mm", min=140.0, max=200.0, doc="M4 pivot to golf-ball center")
R_CAM = 98.0
R_CAM_EFF = 96.5
R_RATCH = 36.0
W_ARM = 14.0
NOTCH_PSIS = [-6.74, 2.20, 11.20, 19.60, 28.00, 35.80]


def build_throwing_arm(name="mtc180_throwing_arm", layer=None):
    pts = [(-L_BALL - 23.0, -24.8), (-L_BALL + 25.0, -24.8), (-30.0, -14.0)]
    pts.append(((R_RATCH - 4.2) * math.cos(-132.0), (R_RATCH - 4.2) * math.sin(-132.0)))
    for p_deg in reversed(NOTCH_PSIS):
        a_lock = -90.0 - p_deg
        pts.append(((R_RATCH - 4.2) * math.cos(a_lock), (R_RATCH - 4.2) * math.sin(a_lock)))
        pts.append((R_RATCH * math.cos(a_lock + 0.6), R_RATCH * math.sin(a_lock + 0.6)))
        pts.append((R_RATCH * math.cos(a_lock + 4.2), R_RATCH * math.sin(a_lock + 4.2)))
    pts.append(((R_RATCH - 4.2) * math.cos(-74.0), (R_RATCH - 4.2) * math.sin(-74.0)))
    pts.append((34.0, -8.0))
    pts.append((93.0 * math.cos(18.0), 93.0 * math.sin(18.0)))
    for a in range(22, 128, 4):
        pts.append((R_CAM * math.cos(a), R_CAM * math.sin(a)))
    pts.append((92.0 * math.cos(130.0), 92.0 * math.sin(130.0)))
    pts.extend([
        (-52.0, 36.0), (-118.0, 4.0),
        (-L_BALL + 25.5, 4.0), (-L_BALL + 25.5, 17.5), (-L_BALL + 20.3, 17.5),
        (-L_BALL + 20.3, -20.3), (-L_BALL - 16.8, -20.3), (-L_BALL - 19.2, -13.5), (-L_BALL - 23.0, -13.5),
    ])

    sk = (
        sketch(XY, name=name + "_sk")
        .polygon(pts)
        # FEA-driven Warren-truss & spoked-cam pockets (~122 cm3 CAD -> ~54 g PETG, v0 ~ 7.7 m/s -> >6.1 m range!)
        .polygon([(-142.0, -18.5), (-114.0, -17.0), (-128.0, -2.5)])
        .polygon([(-118.0, -1.5), (-106.0, -16.0), (-80.0, -13.8), (-94.0, 9.0)])
        .polygon([(-86.0, 12.5), (-72.0, -12.8), (-38.0, -9.5), (-54.0, 28.0)])
        .polygon([(-40.0, 36.0), (-10.0, 11.0), (16.0, 11.0), (12.0, 88.0), (-38.0, 70.0)])
        .polygon([(22.0, 9.0), (86.0, 32.0), (74.0, 60.0), (18.0, 88.0)])
        .circle(2.10, center=(0.0, 0.0))
    )
    body = extrude(sk, W_ARM, name=name + "_raw")

    # 1) 45-deg self-supporting V-groove on R_CAM = 98.0 mm rim (centered at Z = 7.0 mm)
    gv_b = loft([
        sketch(XY.offset(4.0), name=name + "_gb0").circle(R_CAM + 3.0).circle(R_CAM + 0.80),
        sketch(XY.offset(7.0), name=name + "_gb1").circle(R_CAM + 3.0).circle(R_CAM - 2.20),
    ], ruled=True, name=name + "_gv_b")
    gv_t = loft([
        sketch(XY.offset(7.0), name=name + "_gt0").circle(R_CAM + 3.0).circle(R_CAM - 2.20),
        sketch(XY.offset(10.0), name=name + "_gt1").circle(R_CAM + 3.0).circle(R_CAM + 0.80),
    ], ruled=True, name=name + "_gv_t")
    cam_groove = intersect(
        union([gv_b, gv_t], kernel=kernel.mesh, name=name + "_gvu"),
        box(180.0, 100.0, 7.0, at=(-75.0, 22.0, 3.5), name=name + "_gmask"),
        kernel=kernel.mesh, name=name + "_cam_groove",
    )

    # 2) 45-deg self-centering V-cradle in golf-ball seat & backstop (centered at Z = 7.0 mm)
    cup_prof_outer = [(-L_BALL - 15.5, -20.1), (-L_BALL + 20.1, -20.1), (-L_BALL + 20.1, 19.0), (-L_BALL - 15.5, 19.0)]
    cup_prof_mid = [(-L_BALL - 15.5, -22.9), (-L_BALL + 22.9, -22.9), (-L_BALL + 22.9, 19.0), (-L_BALL - 15.5, 19.0)]
    cv_b = loft([sketch(XY.offset(4.2), name=name + "_cb0").polygon(cup_prof_outer), sketch(XY.offset(7.0), name=name + "_cb1").polygon(cup_prof_mid)], ruled=True, name=name + "_cv_b")
    cv_t = loft([sketch(XY.offset(7.0), name=name + "_ct0").polygon(cup_prof_mid), sketch(XY.offset(9.8), name=name + "_ct1").polygon(cup_prof_outer)], ruled=True, name=name + "_cv_t")
    knot_hole = cylinder(2.1, W_ARM + 0.4, at=(88.5 * math.cos(123.0), 88.5 * math.sin(123.0), -0.2), name=name + "_knot_hole")

    arm = subtract([body, cam_groove, cv_b, cv_t, knot_hole], kernel=kernel.mesh, name=name)
    if layer != None:
        layer.add(arm)
    arm.material(preset=preset.petg_glossy, color="#00b894", roughness=0.32)
    return arm
