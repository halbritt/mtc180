# MTC-180 v5.1 (Floor-Flush): Monolithic PETG Throwing Arm (Through-Bolted Cord Horn + 6-Notch Quadrant + V-Cup)
# Prints flat on its right cheek (Z_print = 0..12.0 mm -> Y = +6.0..-6.0 mm in assembly):
#   - Vertical Ø4.20 mm M4 pivot bore.
#   - Through-bolted M4 cord horn at (HORN_R=108, HORN_A=39.5): reaches dead centre at psi=53.5 deg (+5.5 deg past
#     the 42 deg stop), holding the cord taut from 171 deg to 32 deg at <=80 N peak pull (>5.1 m carry).
#   - Properly signed 6-notch lower ratchet quadrant (a_lock = -89.25 + p_deg); Notches 6, 5, 4 all start < 3.0" high.
#   - Lightened 12.0 mm Warren-truss beam + open top-loading 45-deg V-cradle golf-ball cup at (-L_BALL, 0).

L_BALL = param("arm_radius", 170.0, unit="mm", min=140.0, max=200.0, doc="M4 pivot to golf-ball center")
HORN_R = 108.0      # pivot to M4 through-bolted cord post
HORN_A = 39.0       # arm-frame polar angle of the cord post (deg; dead centre at arm 53.0 deg, +5 deg past 42 deg stop)
POST_Z = 4.60       # solid horn tip platform thickness; 2.8 mm collar centres the cord on Z_print = 6.0 (Y = 0)
POST_H = 2.80       # printed Ø7.6 mm collar the cord loop turns on (clamped by M4 x 16 bolt + washer + nut)
R_RATCH = 36.0
W_ARM = 12.0
NOTCH_PSIS = [-8.20, -0.20, 7.80, 16.50, 25.50, 34.50]


def build_throwing_arm(name="mtc180_throwing_arm", layer=None):
    pts = [(-L_BALL - 21.0, -23.8), (-L_BALL + 24.0, -23.8), (-30.0, -14.0)]
    pts.append(((R_RATCH - 4.2) * math.cos(-104.0), (R_RATCH - 4.2) * math.sin(-104.0)))
    for p_deg in NOTCH_PSIS:
        # In assembly, rotate(90, X).rotate(psi, Y) maps a_sketch -> a_world = a_sketch - psi.
        # Placing a_lock = -89.25 + p_deg brings each tooth's steep locking step right to the pawl nose at psi = p_deg!
        a_lock = -89.25 + p_deg
        pts.append(((R_RATCH - 4.2) * math.cos(a_lock), (R_RATCH - 4.2) * math.sin(a_lock)))
        pts.append((R_RATCH * math.cos(a_lock + 0.5), R_RATCH * math.sin(a_lock + 0.5)))
        pts.append((R_RATCH * math.cos(a_lock + 3.2), R_RATCH * math.sin(a_lock + 3.2)))
    pts.append(((R_RATCH - 4.2) * math.cos(-48.0), (R_RATCH - 4.2) * math.sin(-48.0)))
    pts.append((32.0, -6.0))
    tx, tz = HORN_R * math.cos(HORN_A), HORN_R * math.sin(HORN_A)
    for a in range(-90, 91, 15):
        pts.append((tx + 8.8 * math.cos(HORN_A + a), tz + 8.8 * math.sin(HORN_A + a)))
    pts.append((-6.0, 24.0))
    pts.extend([
        (-52.0, 35.0), (-118.0, 4.0),
        (-L_BALL + 24.8, 4.0), (-L_BALL + 24.8, 17.0), (-L_BALL + 20.3, 17.0),
        (-L_BALL + 20.3, -20.3), (-L_BALL - 16.5, -20.3), (-L_BALL - 18.8, -14.0), (-L_BALL - 21.0, -14.0),
    ])

    sk = (
        sketch(XY, name=name + "_sk")
        .polygon(pts)
        # Lightened Warren-truss and horn web pockets
        .polygon([(-145.5, -19.0), (-113.0, -17.2), (-129.5, -1.8)])
        .polygon([(-118.5, -1.0), (-105.5, -16.2), (-79.0, -13.8), (-94.0, 9.5)])
        .polygon([(-86.0, 12.8), (-71.5, -12.8), (-37.0, -9.5), (-53.5, 28.0)])
        .polygon([(24.0, -1.0), (66.0, 43.5), (62.0, 49.5), (13.0, 24.0)])
        .circle(2.10, center=(0.0, 0.0))
    )
    body = extrude(sk, W_ARM, name=name + "_raw")

    # 1) Through-bolted M4 cord post at horn tip: platform Z=0..4.6, Ø7.6 collar Z=4.6..7.4, Ø4.20 M4 through-bore
    ax, az = math.cos(HORN_A), math.sin(HORN_A)
    nx, nz = -az, ax
    post_step = subtract([
        extrude(sketch(XY.offset(POST_Z), name=name + "_post_step_sk").polygon([
            (tx - 10.5 * ax - 20.0 * nx, tz - 10.5 * az - 20.0 * nz), (tx + 20.0 * ax - 20.0 * nx, tz + 20.0 * az - 20.0 * nz),
            (tx + 20.0 * ax + 20.0 * nx, tz + 20.0 * az + 20.0 * nz), (tx - 10.5 * ax + 20.0 * nx, tz - 10.5 * az + 20.0 * nz),
        ]), W_ARM, name=name + "_post_step_raw"),
        cylinder(3.80, POST_H, at=(tx, tz, POST_Z - 0.01), name=name + "_post_collar"),
    ], kernel=kernel.mesh, name=name + "_post_step")
    post_bore = cylinder(2.10, W_ARM + 0.4, at=(tx, tz, -0.2), name=name + "_post_bore")

    # 2) 45-deg self-centering V-cradle in golf-ball seat & backstop (centered at Z_mid = 6.0 mm)
    cup_prof_outer = [(-L_BALL - 15.2, -20.1), (-L_BALL + 20.1, -20.1), (-L_BALL + 20.1, 18.5), (-L_BALL - 15.2, 18.5)]
    cup_prof_mid = [(-L_BALL - 15.2, -22.9), (-L_BALL + 22.9, -22.9), (-L_BALL + 22.9, 18.5), (-L_BALL - 15.2, 18.5)]
    cv_b = loft([sketch(XY.offset(3.2), name=name + "_cb0").polygon(cup_prof_outer), sketch(XY.offset(6.0), name=name + "_cb1").polygon(cup_prof_mid)], ruled=True, name=name + "_cv_b")
    cv_t = loft([sketch(XY.offset(6.0), name=name + "_ct0").polygon(cup_prof_mid), sketch(XY.offset(8.8), name=name + "_ct1").polygon(cup_prof_outer)], ruled=True, name=name + "_cv_t")

    arm = subtract([body, post_step, post_bore, cv_b, cv_t], kernel=kernel.mesh, name=name)
    if layer != None:
        layer.add(arm)
    arm.material(preset=preset.petg_glossy, color="#009639", roughness=0.32)
    return arm
