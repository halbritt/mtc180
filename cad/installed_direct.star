# MTC-180 Direct-Drive Assembly: rail arm bolted straight to the 3-bail coupler on three flat-mounted traps
# Rubric ("The Mousetrap Catapult.pdf") checks + spring clearance + trigger pull, launch sweep and ball roll-off.
#
#   - 390 x 204 x 18 mm base flush on the floor; three Victor traps flat on it, hinge line at X = 0.
#   - Arm cocks back to 173 deg (pointing -X), is held by a hook sear at its tip, and swings up and over to a
#     foam stop at 14 deg. The ball rolls out along the rails and leaves the tip near 88 deg (arm about vertical).
#   - Ball motion along the rail is the rolling solution from analysis/direct_arm_sim.py for hole 1A.

load("bail_coupler.star", "build_bail_coupler", "TRAP_PITCH", "WIRE_HALF_CC", "Z_WIRE", "X_M4", "M4_YS")
load("direct_arm.star", "build_direct_arm", "build_ball_backstop", "rail_top", "ball_start_x", "BALL_R", "L_TIP", "RIDE_H",
     "PEG_X0", "PEG_PITCH", "PEG_COUNT", "BLOCK_LEN", "BLOCK_HOLE_OFF", "FLOOR_T", "X_RISE1", "HZ_ROOT", "HZ_TIP")
load("direct_trigger.star", "build_sear_hook", "build_sear_bracket", "build_stop_wedge", "stop_wedge_dims", "sear_pivot",
     "SEAR_T", "SEAR_OPEN_DEG", "STOP_DEG", "STOP_W", "PAD_T", "PIVOT_H")

peg = param("peg", 1, min=1, max=PEG_COUNT, step=1, doc="Backstop hole (1 = longest throw)")
flip = param("flip", 0, min=0, max=1, step=1, doc="1 = backstop turned round for a 5 mm half-step")
stroke = param("stroke", -0.20, min=-0.20, max=1.40, step=0.02)

T_BOARD = 18.0
ZH = T_BOARD + 8.0 + 3.50     # hinge axis above the floor
COCK_DEG = 173.0
# Rolling solution for hole 1A: arm angle (deg) -> ball travel along the rail (mm)
SIM_TH = [173.0, 172.1, 169.2, 164.7, 158.3, 150.8, 142.0, 132.8, 123.1, 113.8, 104.6, 96.3, 88.5]
SIM_S = [0.0, 0.6, 2.5, 5.6, 10.5, 16.8, 25.4, 35.7, 48.7, 63.3, 80.7, 99.4, 120.5]
REL_SPEED = 5890.0            # mm/s at release
REL_ELEV = 35.1               # deg above horizontal

sweep_t = math.clamp(stroke, 0.0, 1.0)
theta = COCK_DEG + (STOP_DEG - COCK_DEG) * sweep_t
sear_open = SEAR_OPEN_DEG * math.clamp((stroke + 0.20) / 0.15, 0.0, 1.0)
gamma = math.atan((HZ_ROOT - HZ_TIP) / (L_TIP - X_RISE1))


def arm_to_world(x, z_part, th):
    y = z_part + Z_WIRE
    return x * math.cos(th) + y * math.sin(th), ZH + x * math.sin(th) - y * math.cos(th)


def pose_on_bail(body, name):
    return body.translate((0.0, 0.0, -Z_WIRE)).rotate(-theta, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, ZH), name=name)


base_board = box(390.0, 204.0, T_BOARD, at=(-240.0, -102.0, 0.0), name="floor_flush_base_board")
base_board.material(color="#c79c6b", roughness=0.48)

bails, traps_wood, springs = [], [], []
c45 = 3.0 * math.cos(45.0)
for idx, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
    t = str(idx + 1)
    tb = box(98.4, 46.1, 8.0, at=(-49.2, yc - 23.05, T_BOARD + 0.01), name="victor_wood_" + t)
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
    bl = sweep_along(sketch(YZ, name="bpr_" + t).circle(0.88, center=(yc - WIRE_HALF_CC, 0.0)), bp, name="bl_" + t).rotate(-theta, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, ZH), name="bail_" + t)
    bl.material(preset=preset.steel, color="#cd7f32")
    bails.append(bl)
    coil = cylinder(3.35, 30.6, name="cl_" + t).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((0.0, yc + 12.9, ZH), name="torsion_coil_" + t)
    coil.material(preset=preset.steel, color="#2f3640")
    springs.append(coil)
    # Moving spring leg as measured from IMG_4479.jpg (ends at X = 25.7 mm over the bail wire)
    sp_path = curve((0.0, yc - 16.5, 2.4), name="sp_" + t).line((25.7, yc - 21.2, 1.9))
    sp_leg = sweep_along(sketch(YZ, name="spr_" + t).circle(0.85, center=(yc - 16.5, 2.4)), sp_path, name="spl_" + t).rotate(-theta, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, ZH), name="spring_leg_" + t)
    sp_leg.material(preset=preset.steel, color="#2f3640")
    springs.append(sp_leg)

coupler_posed = pose_on_bail(build_bail_coupler(name="coupler_raw"), "bail_coupler_posed")
# Six M4 x 10 pan heads + fender washers on the coupler's shelf (trailing side: faces the trap wood when cocked)
hw = []
for i, y_m in enumerate(M4_YS):
    hw.append(cylinder(4.5, 1.0, at=(X_M4, y_m, 4.0), name="washer_" + str(i)))
    hw.append(cylinder(3.5, 3.0, at=(X_M4, y_m, 5.0), name="head_" + str(i)))
coupler_screws = pose_on_bail(union(hw, kernel=kernel.mesh, name="m4_raw"), "coupler_m4_hardware")
coupler_screws.material(preset=preset.steel, color="#b2bec3")


def flip_to_arm(body):
    return body.rotate(180.0, axis=(1.0, 0.0, 0.0))


arm_posed = pose_on_bail(flip_to_arm(build_direct_arm(name="arm_raw")), "direct_arm_posed")

peg_x = PEG_X0 + PEG_PITCH * (peg - 1)
block_raw = build_ball_backstop(name="backstop_raw")
if flip == 1:
    block_arm = block_raw.translate((peg_x - BLOCK_HOLE_OFF, 0.0, FLOOR_T))
else:
    block_arm = block_raw.rotate(180.0, axis=(0.0, 0.0, 1.0)).translate((peg_x + BLOCK_HOLE_OFF, 0.0, FLOOR_T))
block_posed = pose_on_bail(flip_to_arm(block_arm), "ball_backstop_posed")
block_screw = pose_on_bail(flip_to_arm(cylinder(3.5, 3.0, at=(peg_x, 0.0, -3.0), name="bs_head_raw")), "backstop_screw_head")
block_screw.material(preset=preset.steel, color="#b2bec3")

# Hook sear + bracket under the tip tongue
px, pz = sear_pivot(ZH, COCK_DEG)
bracket_posed = build_sear_bracket(name="bracket_raw").translate((px, 0.0, T_BOARD + 0.01), name="sear_bracket_posed")
hook_posed = (
    build_sear_hook(name="hook_raw")
    .translate((0.0, 0.0, -SEAR_T / 2.0))
    .rotate(90.0, axis=(1.0, 0.0, 0.0))
    .rotate(-sear_open, axis=(0.0, 1.0, 0.0))
    .translate((px, 0.0, pz), name="sear_hook_posed")
)
so = sear_open
sx = px + (-7.0) * math.cos(so) - 34.0 * math.sin(so)
sz = pz - 7.0 * math.sin(so) + 34.0 * math.cos(so)
pull = 14.0 * sear_open / SEAR_OPEN_DEG
string = sweep_along(
    sketch(YZ.offset(sx), name="str_sk").circle(0.9, center=(0.0, sz)),
    curve((sx, 0.0, sz), name="str_path").line((-262.0 - pull, 0.0, 44.0)),
    name="pull_string",
)
string.material(color="#ff5252", roughness=0.45)
handle = cylinder(4.2, 32.0, name="ph_raw").translate((0.0, 0.0, -16.0)).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((-262.0 - pull, 0.0, 44.0), name="pull_handle")
handle.material(preset=preset.petg_glossy, color="#D6001C")

# Stop wedge + foam pad near the arm's centre of percussion
wx0, wx1, wh0, wh1 = stop_wedge_dims(ZH, T_BOARD)
stop_posed = build_stop_wedge(wx1 - wx0, wh0, wh1, name="wedge_raw").translate((wx0, 0.0, T_BOARD + 0.01), name="stop_wedge_posed")
stop_pad = extrude(
    sketch(XZ.offset(-STOP_W / 2.0), name="pad_sk").polygon([(wx0, T_BOARD + wh0 + 0.02), (wx1, T_BOARD + wh1 + 0.02), (wx1, T_BOARD + wh1 + PAD_T), (wx0, T_BOARD + wh0 + PAD_T)]),
    STOP_W, name="stop_foam_pad",
)
stop_pad.material(color="#2d3436", roughness=0.9)

# Golf ball: on the rails until it rolls off the tip, then ballistic
x0 = ball_start_x(peg - 1, flip == 1)
s_end = (L_TIP - x0) / math.cos(gamma)
s_tab = [v * s_end / SIM_S[-1] for v in SIM_S]
th_rel = SIM_TH[-1]
if theta >= th_rel:
    s_now = s_tab[-1]
    for i in range(len(SIM_TH) - 1):
        if theta <= SIM_TH[i] and theta >= SIM_TH[i + 1]:
            s_now = s_tab[i] + (s_tab[i + 1] - s_tab[i]) * (SIM_TH[i] - theta) / (SIM_TH[i] - SIM_TH[i + 1])
    xb = x0 + s_now * math.cos(gamma) + 0.05
    bx, bz = arm_to_world(xb, rail_top(xb) + (RIDE_H + 0.06) / math.cos(gamma), theta)
else:
    rx, rz = arm_to_world(L_TIP, rail_top(L_TIP) + (RIDE_H + 0.06) / math.cos(gamma), th_rel)
    # Bare arm after release: 25 rad/s rising to ~72 rad/s at the stop (constant angular acceleration)
    d_rad = (th_rel - theta) * 3.14159265 / 180.0
    ft = (-25.0 + math.sqrt(625.0 + 2.0 * 1750.0 * d_rad)) / 1750.0 + math.clamp(stroke - 1.0, 0.0, 0.4) * 0.12
    bx = rx + REL_SPEED * math.cos(REL_ELEV) * ft
    bz = rz + REL_SPEED * math.sin(REL_ELEV) * ft - 0.5 * 9806.65 * ft * ft
ball = sphere(BALL_R, center=(bx, 0.0, bz), name="golf_ball")
ball.material(preset=preset.abs, color="#f5f6fa", roughness=0.24, texture="dots", scale=4.2)

animation("direct_drive_launch", [
    keyframe(0.0, stroke=-0.20, camera=view(az=32, el=18), ease=ease.linear),
    keyframe(0.7, stroke=0.0, camera=view(az=28, el=17), ease=ease.ease_in),
    keyframe(2.0, stroke=1.0, camera=view(az=20, el=15), ease=ease.linear),
    keyframe(3.2, stroke=1.40, camera=view(az=14, el=14)),
], fps=20, loop=True)


def verify_direct_drive():
    assert_solid(arm_posed)
    # Rubric Design #4 / #5: base <= 1 in thick, inside 2 ft x 2 ft, flush; traps flat on the base; ball within 3 in of the ground
    assert_true(T_BOARD <= 25.4, msg="Base thicker than 1 inch")
    assert_true(390.0 <= 609.6 and 204.0 <= 609.6, msg="Base larger than the 2 ft x 2 ft launch site")
    for part in traps_wood + [bracket_posed, stop_posed]:
        df = distance(part, base_board)
        assert_true(not df.overlap and df.distance < 0.05, msg="%s is not flat on the base (gap=%s)" % (part.name, df.distance))
    if stroke <= 0.0:
        assert_true(bz - BALL_R < 76.2, msg="Cocked ball is more than 3 inches off the floor: %s mm" % (bz - BALL_R))
    # Spring clearance (IMG_4479 leg geometry): printed arm and backstop stay > 2 mm from every coil and leg
    for sp in springs:
        for part in [arm_posed, block_posed, coupler_posed]:
            ds = distance(part, sp)
            assert_true(not ds.overlap and ds.distance > 2.0, msg="%s too close to %s: %s mm" % (part.name, sp.name, ds.distance))
    for bl in bails:
        assert_true(not distance(arm_posed, bl).overlap, msg="Arm overlaps %s" % bl.name)
    fixed = [base_board, bracket_posed, stop_posed] + traps_wood
    for mover in [arm_posed, coupler_posed, coupler_screws, block_posed, block_screw]:
        for obs in fixed:
            assert_true(not distance(mover, obs).overlap, msg="%s hits %s at stroke=%s" % (mover.name, obs.name, stroke))
    assert_true(not distance(arm_posed, stop_pad).overlap, msg="Arm sinks into the stop pad at stroke=%s" % stroke)
    if stroke >= 1.0:
        assert_true(distance(arm_posed, stop_pad).distance < 0.8, msg="Arm does not reach the stop pad: %s" % distance(arm_posed, stop_pad).distance)
    # Sear: closed hook sits on the tongue; opened hook and its bracket are clear of everything that moves
    dh = distance(arm_posed, hook_posed)
    if stroke <= -0.20:
        assert_true(not dh.overlap and dh.distance < 0.4, msg="Closed sear is not on the tongue (gap=%s, overlap=%s)" % (dh.distance, dh.overlap))
    if stroke >= 0.0:
        assert_true(not dh.overlap, msg="Open sear is in the arm's path at stroke=%s" % stroke)
    assert_true(not distance(hook_posed, bracket_posed).overlap, msg="Sear hook binds in its bracket (open=%s)" % sear_open)
    assert_true(not distance(hook_posed, base_board).overlap, msg="Sear hook hits the base")
    # Ball: rides the rails without interpenetrating, and clears every other part all the way out
    for obs in [arm_posed, block_posed, coupler_posed, hook_posed, bracket_posed, stop_posed, stop_pad, base_board] + traps_wood:
        assert_true(not distance(ball, obs).overlap, msg="Ball hits %s at stroke=%s" % (obs.name, stroke))
    if theta >= th_rel:
        assert_true(distance(ball, arm_posed).distance < 0.3, msg="Ball is not on the rails at stroke=%s (gap=%s)" % (stroke, distance(ball, arm_posed).distance))
    return arm_posed.volume()


test(
    "direct-drive arm: rubric (flat traps, floor-flush base, ball < 3 in), spring clearance, sear, stop and ball path",
    verify_direct_drive,
    sweep={"stroke": [-0.20, -0.04, 0.0, 0.10, 0.30, 0.50, 0.54, 0.75, 1.0, 1.30]},
)
