# MTC-180 v5 (Floor-Flush): Monolithic PETG Throwing Arm (Cord Horn + 6-Notch Quadrant + V-Cup)
# Prints flat on its left cheek (Z_print = 0..14.0 mm -> Y = -7.0..+7.0 mm in assembly):
#   - Vertical Ø4.20 mm M4 pivot bore.
#   - Cord horn: the drive cord ties to an M4 screw post at (HORN_R, HORN_A).  There is no cam wrap; the
#     horn is a crank that reaches dead centre (post, pivot and roller in line) just past the arm stop, so
#     the arm and the bails finish their strokes together (see analysis/cam_launch_sim.py).
#   - 6-notch lower ratchet quadrant (R_RATCH = 36.0 mm) for range selection with zero loose pins.
#   - Open top-loading 45-deg V-cradle golf-ball cup + centrifugal backstop at (-L_BALL, 0).

L_BALL = param("arm_radius", 170.0, unit="mm", min=140.0, max=200.0, doc="M4 pivot to golf-ball center")
HORN_R = 104.0      # pivot to cord post
HORN_A = 31.5       # arm-frame polar angle of the cord post (deg)
POST_Z = 5.70       # tip platform thickness; cord centre sits 1.3 mm above it, on the arm's centre plane
POST_H = 2.60       # printed collar the cord loop turns on (washer + M4 x 8 screw on top)
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
    # Cord horn: straight lower edge from the quadrant, round tip boss, upper edge back to the hub
    tx, tz = HORN_R * math.cos(HORN_A), HORN_R * math.sin(HORN_A)
    for a in range(-90, 91, 15):
        pts.append((tx + 8.6 * math.cos(HORN_A + a), tz + 8.6 * math.sin(HORN_A + a)))
    pts.append((-6.0, 24.0))
    pts.extend([
        (-52.0, 36.0), (-118.0, 4.0),
        (-L_BALL + 25.5, 4.0), (-L_BALL + 25.5, 17.5), (-L_BALL + 20.3, 17.5),
        (-L_BALL + 20.3, -20.3), (-L_BALL - 16.8, -20.3), (-L_BALL - 19.2, -13.5), (-L_BALL - 23.0, -13.5),
    ])

    sk = (
        sketch(XY, name=name + "_sk")
        .polygon(pts)
        # Warren-truss and horn lightening pockets
        .polygon([(-142.0, -18.5), (-114.0, -17.0), (-128.0, -2.5)])
        .polygon([(-118.0, -1.5), (-106.0, -16.0), (-80.0, -13.8), (-94.0, 9.0)])
        .polygon([(-86.0, 12.5), (-72.0, -12.8), (-38.0, -9.5), (-54.0, 28.0)])
        .polygon([(24.0, -4.0), (70.0, 36.5), (68.0, 42.0), (14.0, 24.0)])
        .circle(2.10, center=(0.0, 0.0))
    )
    body = extrude(sk, W_ARM, name=name + "_raw")

    # 1) Cord post at the horn tip: platform stepped down to POST_Z, printed collar, Ø3.5 self-tapping M4 pilot
    ax, az = math.cos(HORN_A), math.sin(HORN_A)
    nx, nz = -az, ax
    post_step = subtract([
        extrude(sketch(XY.offset(POST_Z), name=name + "_post_step_sk").polygon([
            (tx - 10.0 * ax - 20.0 * nx, tz - 10.0 * az - 20.0 * nz), (tx + 20.0 * ax - 20.0 * nx, tz + 20.0 * az - 20.0 * nz),
            (tx + 20.0 * ax + 20.0 * nx, tz + 20.0 * az + 20.0 * nz), (tx - 10.0 * ax + 20.0 * nx, tz - 10.0 * az + 20.0 * nz),
        ]), W_ARM, name=name + "_post_step_raw"),
        cylinder(3.6, POST_H, at=(tx, tz, POST_Z - 0.01), name=name + "_post_collar"),
    ], kernel=kernel.mesh, name=name + "_post_step")
    post_pilot = cylinder(1.75, W_ARM + 0.4, at=(tx, tz, -0.2), name=name + "_post_pilot")

    # 2) 45-deg self-centering V-cradle in golf-ball seat & backstop (centered at Z = 7.0 mm)
    cup_prof_outer = [(-L_BALL - 15.5, -20.1), (-L_BALL + 20.1, -20.1), (-L_BALL + 20.1, 19.0), (-L_BALL - 15.5, 19.0)]
    cup_prof_mid = [(-L_BALL - 15.5, -22.9), (-L_BALL + 22.9, -22.9), (-L_BALL + 22.9, 19.0), (-L_BALL - 15.5, 19.0)]
    cv_b = loft([sketch(XY.offset(4.2), name=name + "_cb0").polygon(cup_prof_outer), sketch(XY.offset(7.0), name=name + "_cb1").polygon(cup_prof_mid)], ruled=True, name=name + "_cv_b")
    cv_t = loft([sketch(XY.offset(7.0), name=name + "_ct0").polygon(cup_prof_mid), sketch(XY.offset(9.8), name=name + "_ct1").polygon(cup_prof_outer)], ruled=True, name=name + "_cv_t")

    arm = subtract([body, post_step, post_pilot, cv_b, cv_t], kernel=kernel.mesh, name=name)
    if layer != None:
        layer.add(arm)
    arm.material(preset=preset.petg_glossy, color="#00b894", roughness=0.32)
    return arm
