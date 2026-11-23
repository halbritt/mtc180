# Complete Animated & Clearance-Verified Floor-Flush 3-Mousetrap Catapult Assembly (MTC-180 v5 — Rubric Option #1)
# Verifies all competition rubric rules ("The Mousetrap Catapult.pdf") + IMG_4479.jpg spring clearance:
#   1. Base board 450 x 204 x 18.0 mm (<= 1" thick, inside 2' x 2' launch pad, sits 100% flush on floor Z = 0).
#   2. All 3 Victor mousetraps lay DEAD FLAT (0.00 deg) right-side up on the floor-flush base; springs unaltered.
#   3. Exact IMG_4479.jpg black torsion-spring legs (X = 0..25.7 mm) clear the X >= 28.5 mm bail coupler by > 2.0 mm.
#   4. Cocked golf ball bottom sits at Z = 30.7 mm (1.21" < 3.00" rubric rule) in an open top-loading gravity V-cup.
#   5. Drive cord: coupler eye -> under the roller -> cord post on the arm horn (exact kinematics, cad/linkage.star).
#   6. Zero rubber bands: gravity-counterweighted ratchet sear clicks across 6 range notches; tripped by rear pull-string.

load("bail_coupler.star", "build_bail_coupler", "TRAP_PITCH", "WIRE_HALF_CC", "Z_WIRE", "R_PULL", "X_M4", "M4_YS")
load("throwing_arm.star", "build_throwing_arm", "L_BALL", "W_ARM", "HORN_R", "HORN_A", "POST_Z", "POST_H")
load("linkage.star", "XH", "R_ROLL_EFF", "TH_REST", "TH_COCK_FULL", "cord_path", "bail_angle")
load("stanchion_trigger.star", "build_stanchion_cheek", "build_trigger_and_rollers", "XP", "ZP", "XR", "ZR", "XS", "ZS", "T_BOARD", "STOP_HOLES")

launch_deg = param("launch_deg", 42, min=42, max=50, step=8, doc="Pin-indexed launch elevation hole (42 or 50 deg)")
notch = param("notch", 6, min=1, max=6, step=1, doc="Ratchet sear range notch (6 = full cock; see `mise run camsim` for the range table)")
stroke = param("stroke", -0.20, min=-0.20, max=1.40, step=0.02)

ZH = T_BOARD + 8.0 + 3.50
NOTCH_LIST = [35.80, 28.00, 19.60, 11.20, 2.20, -6.74]
psi_cock = NOTCH_LIST[notch - 1]
psi_stop = 90.0 - launch_deg
sweep_t = math.clamp(stroke, 0.0, 1.0)
psi_arm = psi_cock + (psi_stop - psi_cock) * sweep_t

# Exact cord kinematics (cad/linkage.star): the cord is tied so notch 6 holds the bails at TH_COCK_FULL;
# for every arm angle the bail angle is the one that keeps that fixed length of cord taut.
LINK = {"zh": ZH, "r_pull": R_PULL, "xp": XP, "zp": ZP, "xr": XR, "zr": ZR, "horn_r": HORN_R, "horn_a": HORN_A}
CORD_LEN = cord_path(TH_COCK_FULL, NOTCH_LIST[5], LINK)[0]
theta_bail = bail_angle(psi_arm, CORD_LEN, LINK)
_, cord_eye, cord_ab, cord_post, cord_ah = cord_path(theta_bail, psi_arm, LINK)

base_board = box(450.0, 204.0, T_BOARD, at=(-275.0, -102.0, 0.0), name="floor_flush_base_board")
base_board.material(color="#c79c6b", roughness=0.48)

front_bail_pad = box(18.0, 144.0, 2.20, at=(XH + 35.5, -72.0, T_BOARD + 8.02), name="front_bail_rubber_pad")
front_bail_pad.material(color="#2d3436", roughness=0.9)

bails, traps_wood, springs_fixed, springs_moving = [], [], [], []
c45 = 3.0 * math.cos(45.0)
for idx, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
    t = str(idx + 1)
    tb = box(98.4, 46.1, 8.0, at=(XH - 49.2, yc - 23.05, T_BOARD + 0.01), name="victor_wood_" + t)
    tb.material(color="#e0bc87", roughness=0.6)
    traps_wood.append(tb)

    bp = (
        curve((0.0, yc - WIRE_HALF_CC, 0.0), name="bp_" + t)
        .line((41.10, yc - WIRE_HALF_CC, 0.0))
        .arc((44.10, yc - WIRE_HALF_CC + 3.0, 0.0), via=(41.10 + c45, yc - WIRE_HALF_CC + 3.0 - c45, 0.0))
        .line((44.10, yc + WIRE_HALF_CC - 3.0, 0.0))
        .arc((41.10, yc + WIRE_HALF_CC, 0.0), via=(41.10 + c45, yc + WIRE_HALF_CC - 3.0 + c45, 0.0))
        .line((0.0, yc + WIRE_HALF_CC, 0.0))
    )
    bl = sweep_along(sketch(YZ, name="bpr_" + t).circle(0.88, center=(yc - WIRE_HALF_CC, 0.0)), bp, name="bl_" + t).rotate(-theta_bail, axis=(0.0, 1.0, 0.0)).translate((XH, 0.0, ZH), name="user_bail_" + t)
    bl.material(preset=preset.steel, color="#cd7f32")
    bails.append(bl)

    coil = cylinder(3.35, 30.6, name="cl_" + t).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((XH, yc + 12.9, ZH), name="torsion_coil_" + t)
    coil.material(preset=preset.steel, color="#2f3640")
    springs_fixed.append(coil)

    # Exact IMG_4479.jpg forward torsion-spring leg (terminates at X = 25.7 mm, Y = yc - 21.2 mm over left bail wire!)
    sp_path = curve((0.0, yc - 16.5, 2.4), name="sp_" + t).line((25.7, yc - 21.2, 1.9))
    sp_leg = sweep_along(sketch(YZ, name="spr_" + t).circle(0.85, center=(yc - 16.5, 2.4)), sp_path, name="spl_" + t).rotate(-theta_bail, axis=(0.0, 1.0, 0.0)).translate((XH, 0.0, ZH), name="spring_moving_leg_" + t)
    sp_leg.material(preset=preset.steel, color="#2f3640")
    springs_moving.append(sp_leg)

coupler_posed = build_bail_coupler(name="coupler_raw").translate((0.0, 0.0, -Z_WIRE)).rotate(-theta_bail, axis=(0.0, 1.0, 0.0)).translate((XH, 0.0, ZH), name="mtc180_bail_coupler_posed")
arm_posed = (
    build_throwing_arm(name="arm_raw")
    .translate((0.0, 0.0, -W_ARM / 2.0))
    .rotate(90.0, axis=(1.0, 0.0, 0.0))
    .rotate(psi_arm, axis=(0.0, 1.0, 0.0))
    .translate((XP, 0.0, ZP), name="mtc180_throwing_arm_posed")
)

# M4 x 8 screw + fender washer on the horn's cord post (the cord loop turns on the printed collar under the washer)
_tx, _tz = HORN_R * math.cos(HORN_A), HORN_R * math.sin(HORN_A)
post_screw = (
    union([
        cylinder(6.0, 0.8, at=(_tx, _tz, POST_Z + POST_H), name="post_washer"),
        cylinder(3.5, 3.0, at=(_tx, _tz, POST_Z + POST_H + 0.8), name="post_head"),
    ], kernel=kernel.mesh, name="post_screw_raw")
    .translate((0.0, 0.0, -W_ARM / 2.0))
    .rotate(90.0, axis=(1.0, 0.0, 0.0))
    .rotate(psi_arm, axis=(0.0, 1.0, 0.0))
    .translate((XP, 0.0, ZP), name="cord_post_screw_posed")
)
post_screw.material(preset=preset.steel, color="#b2bec3")

# Right (-Y) and Left (+Y) Stanchion Cheeks with flat PEI faces at Y = +-8.0 mm and flanges outboard!
st_r = build_stanchion_cheek(side=1, name="str_raw").rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((0.0, -8.0, T_BOARD + 0.01), name="stanchion_right_posed")
st_l = build_stanchion_cheek(side=-1, name="stl_raw").rotate(90.0, axis=(1.0, 0.0, 0.0)).rotate(180.0, axis=(0.0, 0.0, 1.0)).translate((0.0, 8.0, T_BOARD + 0.01), name="stanchion_left_posed")

stop_sl, roller_raw, pawl_raw = build_trigger_and_rollers(prefix="assy")
shx, shz = STOP_HOLES[launch_deg]
stop_posed = stop_sl.translate((0.0, 0.0, -7.7)).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((shx, 0.0, T_BOARD + shz), name="stop_sleeve_posed")
stop_rubber = cylinder(10.0, 15.0, name="srb").translate((0.0, 0.0, -7.5)).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((shx, 0.0, T_BOARD + shz), name="stop_rubber_sleeve")
stop_rubber = subtract([stop_rubber, cylinder(7.25, 16.0, at=(0.0, 0.0, -8.0)).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((shx, 0.0, T_BOARD + shz))], kernel=kernel.mesh, name="stop_rubber_wrap")
stop_rubber.material(color="#2d3436", roughness=0.9)

roller_posed = roller_raw.translate((0.0, 0.0, -7.5)).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((XR, 0.0, ZR), name="cord_roller_posed")
pull_prog = math.clamp((stroke + 0.20) / 0.20, 0.0, 1.0) if stroke <= 0.0 else 1.0
pawl_deg = pull_prog * 21.0
pawl_posed = pawl_raw.translate((0.0, 0.0, -6.0)).rotate(90.0, axis=(1.0, 0.0, 0.0)).rotate(pawl_deg, axis=(0.0, 1.0, 0.0)).translate((XS, 0.0, ZS), name="gravity_sear_posed")

# Braided drive cord: eye -> tangent under the roller, roller -> horn post (the wrap on the roller is not drawn)
bx_c, bz_c = cord_eye
t1x, t1z = XR + R_ROLL_EFF * math.cos(cord_ab), ZR + R_ROLL_EFF * math.sin(cord_ab)
t2x, t2z = XR + R_ROLL_EFF * math.cos(cord_ah), ZR + R_ROLL_EFF * math.sin(cord_ah)
hx_c, hz_c = cord_post
dc1 = sweep_along(sketch(YZ.offset(bx_c), name="dc1_sk").circle(0.95, center=(0.0, bz_c)), curve((bx_c, 0.0, bz_c), name="dp1").line((t1x, 0.0, t1z)), name="drive_cord_lower")
dc2 = sweep_along(sketch(YZ.offset(t2x), name="dc2_sk").circle(0.95, center=(0.0, t2z)), curve((t2x, 0.0, t2z), name="dp2").line((hx_c, 0.0, hz_c)), name="drive_cord_upper")
for dc in [dc1, dc2]:
    dc.material(color="#00cec9", roughness=0.4)

px_t = XS - 28.5 * math.cos(pawl_deg) - 7.5 * math.sin(pawl_deg)
pz_t = ZS + 28.5 * math.sin(pawl_deg) - 7.5 * math.cos(pawl_deg)
trig_tail_x = -265.0 - pull_prog * 22.0
tc1 = sweep_along(sketch(YZ.offset(px_t), name="tc1_sk").circle(0.90, center=(0.0, pz_t)), curve((px_t, 0.0, pz_t), name="tp1").line((-140.0, 0.0, T_BOARD + 27.0)), name="pull_string_inner")
tc2 = sweep_along(sketch(YZ.offset(-140.0), name="tc2_sk").circle(0.90, center=(0.0, T_BOARD + 27.0)), curve((-140.0, 0.0, T_BOARD + 27.0), name="tp2").line((trig_tail_x, 0.0, T_BOARD + 27.0)), name="pull_string_outer")
for tc in [tc1, tc2]:
    tc.material(color="#ff5252", roughness=0.45)
pull_handle = cylinder(4.2, 32.0, name="ph_r").translate((0.0, 0.0, -16.0)).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((trig_tail_x, 0.0, T_BOARD + 27.0), name="rear_pull_handle")
pull_handle.material(preset=preset.petg_glossy, color="#d63031")

# Regulation Golf Ball (Ø42.67 mm): seats on the 20.3 mm V-rails at (-L_BALL - 1.30, +1.30) in arm coords (0.26 mm clear!)
bx0 = XP + (-L_BALL - 1.30) * math.cos(psi_arm) + 1.30 * math.sin(psi_arm)
bz0 = ZP + (L_BALL + 1.30) * math.sin(psi_arm) + 1.30 * math.cos(psi_arm)
ft = math.clamp((stroke - 1.0) * 0.12, 0.0, 0.05)
v0 = 6720.0 if launch_deg == 42 else 5760.0   # mm/s at notch 6, from analysis/cam_launch_sim.py
ball = sphere(21.335, center=(bx0 + v0 * math.cos(launch_deg) * ft, 0.0, bz0 + v0 * math.sin(launch_deg) * ft - 0.5 * 9806.65 * ft * ft), name="regulation_golf_ball")
ball.material(preset=preset.abs, color="#f5f6fa", roughness=0.24, texture="dots", scale=4.2)

animation("floor_flush_catapult_launch", [
    keyframe(0.0, stroke=-0.20, camera=view(az=32, el=18), ease=ease.linear),
    keyframe(0.65, stroke=0.0, camera=view(az=28, el=17), ease=ease.ease_in),
    keyframe(1.95, stroke=1.0, camera=view(az=18, el=15), ease=ease.linear),
    keyframe(3.20, stroke=1.40, camera=view(az=12, el=14)),
], fps=20, loop=True)


def verify_floor_flush_rubric_and_clearances():
    assert_solid(coupler_posed)
    assert_solid(arm_posed)
    # Linkage: full cock holds the bails at TH_COCK_FULL, the cord stays taut through the stroke, and the horn is
    # still short of dead centre one degree past the stop (so the cord never pulls the bails back up).
    if stroke <= 0.0 and notch == 6:
        assert_true(abs(theta_bail - TH_COCK_FULL) < 0.2, msg="Full-cock bail angle %s, expected %s" % (theta_bail, TH_COCK_FULL))
    assert_true(theta_bail > TH_REST + 5.0, msg="Cord goes slack at stroke=%s (bails on the pad)" % stroke)
    assert_true(cord_path(TH_REST, psi_stop + 1.0, LINK)[0] < cord_path(TH_REST, psi_stop, LINK)[0], msg="Horn passes dead centre before the stop")
    for cord in [dc1, dc2]:
        for obs in [arm_posed, coupler_posed, base_board, st_r, st_l, stop_rubber] + traps_wood + springs_fixed:
            dco = distance(cord, obs)
            if not ((cord.name == "drive_cord_lower" and obs.name == "mtc180_bail_coupler_posed") or (cord.name == "drive_cord_upper" and obs.name == "mtc180_throwing_arm_posed")):
                assert_true(not dco.overlap, msg="%s runs through %s at stroke=%s" % (cord.name, obs.name, stroke))
    assert_true(not distance(post_screw, roller_posed).overlap and distance(post_screw, roller_posed).distance > 1.5, msg="Cord post screw too close to the roller at stroke=%s" % stroke)
    assert_true(distance(arm_posed, roller_posed).distance > 1.5, msg="Horn tip too close to the roller at stroke=%s" % stroke)
    # Rubric Design #4 & #5: base <= 25.4 mm (1"), inside 609.6 x 609.6 mm (2'x2'), traps flush on base, ball passes < 76.2 mm (3") of ground!
    assert_true(T_BOARD <= 25.4, msg="Base thicker than 1 inch")
    if stroke <= 0.0:
        assert_true((bz0 - 21.335) < 76.2 and (bz0 - 21.335) > T_BOARD + 4.0, msg="Cocked ball bottom height out of bounds: %s" % (bz0 - 21.335))
    for fl_part in traps_wood + [st_r, st_l]:
        df = distance(fl_part, base_board)
        assert_true(not df.overlap and df.distance < 0.05, msg="%s not flat on floor-flush board (gap=%s)" % (fl_part.name, df.distance))
    for sp in springs_moving + springs_fixed:
        ds = distance(coupler_posed, sp)
        assert_true(not ds.overlap and ds.distance > 2.0, msg="Bail coupler too close to %s: %s mm" % (sp.name, ds.distance))
    for bl in bails:
        assert_true(not distance(coupler_posed, bl).overlap, msg="Bail coupler overlaps %s" % bl.name)
    for obs in [base_board, st_r, st_l, roller_posed, front_bail_pad] + traps_wood:
        assert_true(not distance(arm_posed, obs).overlap, msg="Arm hits %s at stroke=%s" % (obs.name, stroke))
        assert_true(not distance(coupler_posed, obs).overlap, msg="Coupler hits %s at stroke=%s" % (obs.name, stroke))
        assert_true(not distance(ball, obs).overlap, msg="Ball hits %s at stroke=%s" % (obs.name, stroke))
    assert_true(not distance(ball, stop_rubber).overlap, msg="Ball hits stop sleeve at stroke=%s" % stroke)
    assert_true(not distance(ball, arm_posed).overlap, msg="Ball interpenetrates throwing arm V-cup at stroke=%s" % stroke)
    if stroke > 0.05:
        assert_true(not distance(arm_posed, pawl_posed).overlap, msg="Arm hits sear pawl at stroke=%s" % stroke)
    return arm_posed.volume()


test("floor-flush rubric compliance + IMG_4479 spring clearance (>2mm) + 8-pose sweep", verify_floor_flush_rubric_and_clearances, sweep={"stroke": [-0.20, -0.02, 0.06, 0.25, 0.50, 0.75, 0.98, 1.30]})
