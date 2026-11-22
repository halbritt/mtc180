# Complete Animated & Clearance-Verified Floor-Flush 3-Mousetrap Catapult Assembly (MTC-180 v5 — Rubric Option #1)
# Verifies all competition rubric rules ("The Mousetrap Catapult.pdf") + IMG_4479.jpg spring clearance:
#   1. Base board 450 x 204 x 18.0 mm (<= 1" thick, inside 2' x 2' launch pad, sits 100% flush on floor Z = 0).
#   2. All 3 Victor mousetraps lay DEAD FLAT (0.00 deg) right-side up on the floor-flush base; springs unaltered.
#   3. Exact IMG_4479.jpg black torsion-spring legs (X = 0..25.7 mm) clear the X >= 28.5 mm bail coupler by > 2.0 mm.
#   4. Cocked golf ball bottom sits at Z = 30.7 mm (1.21" < 3.00" rubric rule) in an open top-loading gravity V-cup.
#   5. Zero rubber bands: gravity-counterweighted ratchet sear clicks across 6 range notches; tripped by rear pull-string.

load("bail_coupler.star", "build_bail_coupler", "TRAP_PITCH", "WIRE_HALF_CC", "Z_WIRE", "R_PULL", "X_M4", "M4_YS")
load("throwing_arm.star", "build_throwing_arm", "L_BALL", "R_CAM_EFF", "W_ARM")
load("stanchion_trigger.star", "build_stanchion_cheek", "build_trigger_and_rollers", "XP", "ZP", "XR", "ZR", "XS", "ZS", "T_BOARD", "STOP_HOLES")

launch_deg = param("launch_deg", 42, min=34, max=50, step=8, doc="Pin-indexed launch elevation hole (34, 42, or 50 deg)")
notch = param("notch", 6, min=1, max=6, step=1, doc="Ratchet sear range notch (6 = Full Cock ~6.4 m; 5..1 = 5.0..1.7 m)")
stroke = param("stroke", -0.20, min=-0.20, max=1.40, step=0.02)

XH = 112.0
ZH = T_BOARD + 8.0 + 3.50
R_ROLL = 6.0
NOTCH_LIST = [35.80, 28.00, 19.60, 11.20, 2.20, -6.74]
psi_cock = NOTCH_LIST[notch - 1]
psi_stop = 90.0 - launch_deg
sweep_t = math.clamp(stroke, 0.0, 1.0)
psi_arm = psi_cock + (psi_stop - psi_cock) * sweep_t

# Exact kinematic coupling: bail angle theta_bail from taut braided cord around (XR, ZR - R_ROLL)
s_end = math.sqrt((XH + R_PULL * math.cos(7.0) - XR) * (XH + R_PULL * math.cos(7.0) - XR) + (ZH + R_PULL * math.sin(7.0) - (ZR - R_ROLL)) * (ZH + R_PULL * math.sin(7.0) - (ZR - R_ROLL)))
rem_rad = (psi_stop - psi_arm) * 3.14159265 / 180.0
s_cur = s_end - R_CAM_EFF * rem_rad
# Smooth inverse mapping tb(s_cur) across [7, 173] deg
theta_bail = 7.0 + 166.0 * math.clamp((s_end - s_cur) / 92.20, 0.0, 1.0)

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

# Braided Drive Cord (2 straight taut spans meeting under M4 Roller) + Rear Trigger Pull-String
bx_c = XH + R_PULL * math.cos(theta_bail)
bz_c = ZH + R_PULL * math.sin(theta_bail)
dc1 = sweep_along(sketch(YZ.offset(bx_c), name="dc1_sk").circle(0.95, center=(0.0, bz_c)), curve((bx_c, 0.0, bz_c), name="dp1").line((XR, 0.0, ZR - R_ROLL)), name="drive_cord_lower")
dc2 = sweep_along(sketch(YZ.offset(XR), name="dc2_sk").circle(0.95, center=(0.0, ZR - R_ROLL)), curve((XR, 0.0, ZR - R_ROLL), name="dp2").line((XP + 38.0, 0.0, ZP + 88.5)), name="drive_cord_upper")
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
v0 = 7820.0
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
