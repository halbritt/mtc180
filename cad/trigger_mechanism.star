# MTC-180 Wood-Board Front-Sear + Rear Pull-String Trigger Mechanism (Zero-Support PETG)
# Mounts directly to the underside of the adjustable wooden trajectory board (z_L = -11.50 mm):
#   - sear_mounting_bridge: screws at front of board (x_L = -(L_BALL + 37.2) = -177.2 mm), holds M4 coaxial pivot
#   - coaxial_rocker_sear : Y=0 over-center self-cocking sear hook + Y=+83 mm outboard pull-lever (1.8 N string pull!)
#   - rear_string_guide   : screws near rear edge of board (x_L = +38 mm, Y = +83 mm), guides pull string out the back

Y_PULL = 83.0
SAFETY_X = 13.25   # Safety-pin axis, bridge-local x (toward the hinge from the sear pivot)
SAFETY_Z = 15.75   # Safety-pin axis height above the mounting face (tongue top is at 13.25)


def _teardrop_xz(sk, cx, cz, r, roof_dir=1.0):
    s = r * 0.7071
    return sk.polygon([
        (cx, cz + roof_dir * r * 1.414),
        (cx + s, cz + roof_dir * s), (cx + r, cz), (cx + s, cz - roof_dir * s),
        (cx, cz - roof_dir * r),
        (cx - s, cz - roof_dir * s), (cx - r, cz), (cx - s, cz + roof_dir * s),
    ])


def build_trigger_parts(prefix="trig"):
    # 1. Stationary Front Sear Mounting Bridge (printed flat on Z = 0..8.2 mm; mounts to z_L = -11.50 mm)
    base_sk = (
        sketch(XY, name=prefix + "_br_sk")
        .rect(18.0, 126.0, center=(0.0, 38.0))
        .circle(2.05, center=(0.0, -19.5))
        .circle(2.05, center=(0.0, 24.0))
        .circle(2.05, center=(0.0, 44.0))
        .circle(2.05, center=(0.0, 61.5))
    )
    br_base = extrude(base_sk, 3.4, name=prefix + "_br_base")
    ears_sk = (
        sketch(XY, name=prefix + "_ears_sk")
        .rect(18.0, 6.0, center=(0.0, -10.0))
        .rect(18.0, 6.0, center=(0.0, 10.0))
        .rect(18.0, 6.0, center=(0.0, Y_PULL - 9.0))
        .rect(18.0, 6.0, center=(0.0, Y_PULL + 9.0))
        .rect(3.4, 13.6, center=(-6.6, 0.0))
        .rect(3.4, 11.6, center=(-6.6, Y_PULL))
    )
    br_ears = extrude(ears_sk, 8.2, name=prefix + "_br_ears")
    # Cut M4 teardrop pivot bores only through the two clevises so screw plates stay full 3.4 mm thick
    b1 = extrude(_teardrop_xz(sketch(XZ.offset(-14.5), name=prefix + "_bb1"), 0.0, 3.80, 2.05, 1.0), 29.0, name=prefix + "_br_b1")
    b2 = extrude(_teardrop_xz(sketch(XZ.offset(-(Y_PULL + 13.5)), name=prefix + "_bb2"), 0.0, 3.80, 2.05, 1.0), 27.0, name=prefix + "_br_b2")
    # Safety-pin yoke: two posts straddle the cocked D-loop tongue (|Y| < 13.5 mm) just inboard of the sear.
    # A 4 mm pin through both posts passes 0.5 mm over the tongue and holds the arm even if the sear lets go.
    yoke_base = box(8.5, 40.4, 3.4, at=(SAFETY_X - 4.25, -20.2, 0.0), name=prefix + "_yoke_base")
    yoke_posts = [
        box(8.5, 6.0, 20.0, at=(SAFETY_X - 4.25, sgn * 17.2 - 3.0, 0.0), name=prefix + "_yoke_post_" + tag)
        for sgn, tag in [(-1.0, "a"), (1.0, "b")]
    ]
    pin_bore = extrude(_teardrop_xz(sketch(XZ.offset(-21.0), name=prefix + "_pin_sk"), SAFETY_X, SAFETY_Z, 2.1, 1.0), 42.0, name=prefix + "_pin_bore")
    bridge = subtract([union([br_base, yoke_base] + br_ears + yoke_posts, kernel=kernel.mesh, name=prefix + "_br_u"), b1, b2, pin_bore], kernel=kernel.mesh, name=prefix + "_sear_bridge")

    # 2. 1-Piece Coaxial Rocker Sear (chamfered D-shaft clears carrier top across 0..25 deg rotation!)
    sh_sk = sketch(XZ.offset(-88.2), name=prefix + "_sh_sk").polygon([
        (-3.8, 0.0), (4.0, 0.0), (4.0, 6.2), (1.5, 9.6), (-2.0, 9.6), (-3.8, 7.8),
    ])
    shaft_blk = extrude(sh_sk, 94.4, name=prefix + "_sh_blk")
    sear_prof = sketch(XZ.offset(-6.2), name=prefix + "_sr_sk").polygon([
        (2.0, 0.0), (13.5, 0.0), (13.5, 3.0), (11.95, 6.2), (9.85, 6.2), (9.85, 3.0), (2.0, 3.0),
    ])
    sear_arm = extrude(sear_prof, 12.4, name=prefix + "_sr_arm")
    lev_prof = _teardrop_xz(
        sketch(XZ.offset(-(Y_PULL + 5.2)), name=prefix + "_lv_sk").polygon([(2.0, 0.0), (26.5, 0.0), (26.5, 8.4), (2.0, 8.4)]),
        22.0, 3.6, 1.80, 1.0,
    )
    lev_arm = extrude(lev_prof, 10.4, name=prefix + "_lv_arm")
    rk_bore_sk = _teardrop_xz(sketch(XZ.offset(-92.0), name=prefix + "_rk_b_sk"), 0.0, 5.0, 2.05, 1.0)
    rk_bore = extrude(rk_bore_sk, 102.0, name=prefix + "_rk_bore")
    rocker = subtract([union([shaft_blk, sear_arm, lev_arm], kernel=kernel.mesh, name=prefix + "_rk_u"), rk_bore], kernel=kernel.mesh, name=prefix + "_coaxial_rocker_sear")

    # 3. Rear Pull-String Guide / Fairlead (printed flat on Z = 0..31.0 mm; mounts at x_L = +38 mm, Y = +83 mm)
    fl_base = extrude(
        sketch(XY, name=prefix + "_fl_bsk").rect(18.0, 30.0, center=(0.0, 0.0)).circle(2.05, center=(0.0, -10.2)).circle(2.05, center=(0.0, 10.2)),
        3.4, name=prefix + "_fl_base",
    )
    fl_pylon = extrude(sketch(XY, name=prefix + "_fl_psk").rect(12.0, 11.0, center=(0.0, 0.0)), 31.0, name=prefix + "_fl_pylon")
    fl_eye = extrude(_teardrop_xz(sketch(YZ.offset(-8.0), name=prefix + "_fl_esk"), 0.0, 25.8, 2.20, 1.0), 16.0, name=prefix + "_fl_eye")
    fairlead = subtract([union([fl_base, fl_pylon], kernel=kernel.mesh, name=prefix + "_fl_u"), fl_eye], kernel=kernel.mesh, name=prefix + "_rear_string_guide")

    for p, col in [(bridge, "#0984e3"), (rocker, "#fdcb6e"), (fairlead, "#0984e3")]:
        p.material(preset=preset.petg_glossy, color=col, roughness=0.34)
    return bridge, rocker, fairlead


BAIL_REST_DEG = 3.37   # arcsin((3.50 - 0.90) / 44.10): front wire touching the flat trap wood
STOP_DEG = 8.4         # Default stop: bail angle above that rest (about 5 deg from the board plane)
PAD_T = 3.0      # Stick-on rubber / foam pad on top of the printed stop block
PAD_GAP = 0.3    # Modelled air gap between pad and truss at the stop


def stop_block_dims(theta_stop, x_strike, h_strike):
    """Stop-block footprint in the board frame: (x_front, x_back, h_front, h_back) for a 12 mm strike zone."""
    drop = h_strike + PAD_GAP + PAD_T
    xs = [(x_strike + dx) * math.cos(theta_stop) + drop * math.sin(theta_stop) for dx in [-6.0, 6.0]]
    hs = [(x_strike + dx) * math.sin(theta_stop) - drop * math.cos(theta_stop) + 11.5 for dx in [-6.0, 6.0]]
    return xs[0], xs[1], hs[0], hs[1]


def build_stop_block(theta_stop, x_strike, h_strike, prefix="trig"):
    # Printed riser for the arm stop: flat base on the board, top face tilted to theta_stop so the three
    # truss ribs land flat on the pad. Two counterbored 4.1 mm holes sit between the ribs, under the pad.
    x0, x1, h0, h1 = stop_block_dims(theta_stop, x_strike, h_strike)
    w = x1 - x0
    blk = extrude(
        sketch(XZ.offset(-33.0), name=prefix + "_sb_sk").polygon([(0.0, 0.0), (w, 0.0), (w, h1), (0.0, h0)]),
        66.0, name=prefix + "_sb_blk",
    )
    cuts = []
    for sgn, tag in [(-1.0, "a"), (1.0, "b")]:
        c = (w / 2.0, sgn * 14.0)
        cuts.append(cylinder(2.05, h1 + 0.4, at=(c[0], c[1], -0.2), name=prefix + "_sb_hole_" + tag))
        # Flat-bottom 7.4 mm counterbore, 2.6 mm deep at the low edge: hides a #6 pan-head wood screw under the pad
        cuts.append(cylinder(3.7, h1 - h0 + 3.0, at=(c[0], c[1], h0 - 2.6), name=prefix + "_sb_cb_" + tag))
    block = subtract([blk] + cuts, kernel=kernel.mesh, name=prefix + "_stop_block")
    block.material(preset=preset.petg_glossy, color="#0984e3", roughness=0.34)
    return block


def pose_trigger_local(arm_radius, sear_open_deg, pull_slack_mm=0.0):
    bridge, rocker, fairlead = build_trigger_parts(prefix="inst_trig")
    x_piv = -(arm_radius + 37.2)
    br_p = bridge.translate((x_piv, 0.0, -11.50), name="sear_bridge_local")
    rk_p = (
        rocker
        .translate((0.0, 0.0, -5.0), name="rk_c")
        .rotate(-90.0 + sear_open_deg, axis=(0.0, 1.0, 0.0), name="rk_r")
        .translate((x_piv, 0.0, -7.70), name="rocker_sear_local")
    )
    fl_p = fairlead.translate((38.0, Y_PULL, -11.50), name="fairlead_local")
    rad = sear_open_deg * 3.14159265 / 180.0
    ex = x_piv + 1.4 * math.cos(rad) + 22.0 * math.sin(rad)
    ez = -7.70 - 1.4 * math.sin(rad) + 22.0 * math.cos(rad)
    x_tail = 88.0 + pull_slack_mm + 22.0 * rad
    s_path = curve((ex, Y_PULL, ez), name="str_path").line((38.0, Y_PULL, 14.30)).line((x_tail, Y_PULL, 14.30))
    p_str = sweep_along(sketch(YZ.offset(ex), name="str_sk").circle(0.95, center=(Y_PULL, ez)), s_path, name="pull_string_local")
    p_str.material(color="#ff5252", roughness=0.45)
    t_handle = cylinder(4.5, 34.0, name="tg_raw").rotate(-90.0, axis=(1.0, 0.0, 0.0)).translate((x_tail, Y_PULL - 17.0, 14.30), name="pull_handle_local")
    t_handle.material(preset=preset.petg_glossy, color="#d63031", roughness=0.32)
    return br_p, rk_p, fl_p, p_str, t_handle
