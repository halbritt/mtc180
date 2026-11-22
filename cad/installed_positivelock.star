# Complete Animated & Clearance-Verified 3D Assembly:
#   - MTC-180L-PL v4 PETG Carrier (driven-side wire seats) + 6x Recessed M3 Washer Screws + Regulation Golf Ball
#   - 3x Stripped Caliper-Exact Mousetraps Mounted DEAD FLAT (0.00 deg) to the 300x204x12mm Trajectory Board
#   - Bail sweep +180.0 deg parallel cocked -> stop_deg above the -3.37 deg rest (front wire on flat wood)
#   - Padded Stop Block under the truss ribs at X_STRIKE (arm stops stop_deg before the bails reach the wood)
#   - Safety Pin through the sear-bridge yoke while standing by
#   - Front Coaxial Over-Center Sear + Outboard Y=+83mm Rear Pull-String + T-Handle Grip
load("carrier_positivelock.star", "build_positivelock_carrier", "L_BALL", "TRAP_PITCH", "WIRE_HALF_CC", "M3_YS", "X_M3", "X_STRIKE", "Z_WIRE")
load("trigger_mechanism.star", "pose_trigger_local", "SAFETY_X", "SAFETY_Z")

launch_deg = param("launch_deg", 42.0, unit="deg", min=10.0, max=80.0, doc="Ball launch elevation (42 deg is the longest range from this release height)")
stop_deg = param("stop_deg", 5.0, unit="deg", min=3.0, max=15.0, doc="Bail angle above its rest on the trap wood where the stop block halts the arm")
stroke = param("stroke", -0.25, min=-0.25, max=1.45, step=0.02)

Z_PIV = 225.0
BAIL_REST_DEG = 3.37  # arcsin((3.50 - 0.90) / 44.10): front Ø1.8mm wire touching flat z_L = -3.50 mm wood
theta_stop = stop_deg - BAIL_REST_DEG   # Bail angle from the board plane where the stop block halts the arm
sweep_t = math.clamp(stroke, 0.0, 1.0)
theta_bail = 180.0 - (180.0 - theta_stop) * sweep_t
alpha_trap_front = launch_deg + 90.0 - theta_stop
alpha_arm = alpha_trap_front + theta_bail

raw_carrier = build_positivelock_carrier(name="poslock_raw")
carrier_posed = (
    raw_carrier
    .translate((0.0, 0.0, -Z_WIRE), name="car_centered")
    .rotate(180.0, axis=(1.0, 0.0, 0.0), name="car_flip")
    .rotate(-alpha_arm, axis=(0.0, 1.0, 0.0), name="car_rot")
    .translate((0.0, 0.0, Z_PIV), name="mtc180_poslock_posed")
)

# 6x M3 wafer-head screws + 9 x 0.8 mm fender washers, fully recessed in the trailing-face pockets (0.25 mm below the face)
m3_screws = []
for idx_s, y_m in enumerate(M3_YS):
    sc = (
        union([
            cylinder(4.5, 0.8, at=(X_M3, y_m, 1.25), name="m3w_" + str(idx_s)),
            cylinder(3.0, 1.0, at=(X_M3, y_m, 0.25), name="m3h_" + str(idx_s)),
        ], kernel=kernel.mesh, name="m3s_" + str(idx_s))
        .translate((0.0, 0.0, -Z_WIRE))
        .rotate(180.0, axis=(1.0, 0.0, 0.0))
        .rotate(-alpha_arm, axis=(0.0, 1.0, 0.0))
        .translate((0.0, 0.0, Z_PIV), name="m3_bail_screw_" + str(idx_s))
    )
    sc.material(preset=preset.steel)
    m3_screws.append(sc)

bails = []
traps_wood = []
coils = []
c45 = 3.0 * math.cos(45.0)
for idx, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
    t = str(idx + 1)
    bp = (
        curve((0.0, yc - WIRE_HALF_CC, 0.0), name="bp_" + t)
        .line((41.10, yc - WIRE_HALF_CC, 0.0))
        .arc((44.10, yc - WIRE_HALF_CC + 3.0, 0.0), via=(41.10 + c45, yc - WIRE_HALF_CC + 3.0 - c45, 0.0))
        .line((44.10, yc + WIRE_HALF_CC - 3.0, 0.0))
        .arc((41.10, yc + WIRE_HALF_CC, 0.0), via=(41.10 + c45, yc + WIRE_HALF_CC - 3.0 + c45, 0.0))
        .line((0.0, yc + WIRE_HALF_CC, 0.0))
    )
    bl = sweep_along(sketch(YZ, name="bpr_" + t).circle(0.88, center=(yc - WIRE_HALF_CC, 0.0)), bp, name="bl_" + t).rotate(-alpha_arm, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, Z_PIV), name="user_bail_" + t)
    bl.material(preset=preset.steel)
    bails.append(bl)

    cl = cylinder(3.1, 28.0, name="cl_" + t).rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((0.0, yc + 14.0, 0.0)).rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, Z_PIV), name="spring_coil_" + t)
    cl.material(preset=preset.brass)
    coils.append(cl)

    # Mounted DEAD FLAT (0.00 deg relative rotation!) flush against the z_L = -11.50 mm underside of cradle!
    tb = (
        box(98.4, 46.1, 8.0, at=(-49.2, yc - 23.05, -11.50), name="tb_" + t)
        .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
        .translate((0.0, 0.0, Z_PIV), name="victor_wood_" + t)
    )
    tb.material(color="#e0bc87", roughness=0.6)
    traps_wood.append(tb)

# 300 x 204 x 12 mm Trajectory Board (x_L = -190..+110 mm; underside at z_L = -11.51 mm = 0.01 mm nominal film to traps & trigger!)
cradle = (
    box(300.0, 204.0, 12.0, at=(-190.0, -102.0, -23.51), name="cradle_raw")
    .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
    .translate((0.0, 0.0, Z_PIV), name="adjustable_trajectory_board")
)
cradle.material(color="#c79c6b", roughness=0.45, opacity=0.34)

# Stop block on the board extension: wood riser + 3 mm rubber pad, top face parallel to the truss rib tops at theta_stop.
# It meets the arm at X_STRIKE (near the centre of percussion), so the bails, staples and screws take almost no shock.
H_STRIKE = 14.6 - Z_WIRE
def _strike_pt(x_arm, drop):
    return (x_arm * math.cos(theta_stop) + (H_STRIKE + drop) * math.sin(theta_stop), x_arm * math.sin(theta_stop) - (H_STRIKE + drop) * math.cos(theta_stop))
_p1, _p2 = _strike_pt(X_STRIKE - 6.0, 0.3), _strike_pt(X_STRIKE + 6.0, 0.3)
_p3, _p4 = _strike_pt(X_STRIKE + 6.0, 3.3), _strike_pt(X_STRIKE - 6.0, 3.3)
stop_pad = (
    extrude(sketch(XZ.offset(-33.0), name="pad_sk").polygon([_p1, _p2, _p3, _p4]), 66.0, name="pad_raw")
    .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
    .translate((0.0, 0.0, Z_PIV), name="stop_rubber_pad")
)
stop_pad.material(color="#2d3436", roughness=0.9)
stop_riser = (
    extrude(sketch(XZ.offset(-33.0), name="riser_sk").polygon([_p4, _p3, (_p3[0], -11.5), (_p4[0], -11.5)]), 66.0, name="riser_raw")
    .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
    .translate((0.0, 0.0, Z_PIV), name="stop_block_riser")
)
stop_riser.material(color="#b88954", roughness=0.55)

stand_base = box(280.0, 252.0, 12.0, at=(-140.0, -126.0, 0.0), name="stand_baseplate")
stand_base.material(color="#d8b589", roughness=0.58)
leg_sk = (
    sketch(XZ, name="leg_sk")
    .polygon([(-92.0, 12.0), (92.0, 12.0), (22.0, Z_PIV + 20.0), (-22.0, Z_PIV + 20.0)])
    .polygon([(-58.0, 34.0), (58.0, 34.0), (12.0, Z_PIV - 24.0), (-12.0, Z_PIV - 24.0)])
)
leg_l = extrude(leg_sk, -12.0, name="leg_l_r").translate((0.0, 102.5, 0.0), name="trunnion_leg_left")
leg_r = copy(leg_l, offset=(0.0, -217.0, 0.0), name="trunnion_leg_right")
leg_l.material(color="#b88954", roughness=0.52, opacity=0.48)
leg_r.material(color="#b88954", roughness=0.52)
trun_l = cylinder(5.5, 24.0, name="tr_l_r").rotate(90.0, axis=(1.0, 0.0, 0.0)).translate((0.0, 120.0, Z_PIV), name="trunnion_knob_l")
trun_r = copy(trun_l, offset=(0.0, -216.0, 0.0), name="trunnion_knob_r")
for tr in [trun_l, trun_r]:
    tr.material(preset=preset.steel)

# Trigger kinematics: stroke -0.25..-0.12 standby; -0.12..0.00 pull-string pulls back & sear rotates 0 -> 21 deg!
pull_prog = math.clamp((stroke + 0.12) / 0.12, 0.0, 1.0)
sear_deg = pull_prog * 21.0
br_l, rk_l, fl_l, str_l, hnd_l = pose_trigger_local(L_BALL, sear_deg, pull_slack_mm=pull_prog * 34.0)
trig_posed = [
    p.rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, Z_PIV), name="posed_" + p.name)
    for p in [br_l, rk_l, fl_l, str_l, hnd_l]
]

# Safety pin: through the yoke over the D-loop tongue while standing by, drawn out sideways before the pull
pin_in = stroke < -0.12
safety_pin = (
    cylinder(2.0, 56.0, name="pin_raw")
    .rotate(90.0, axis=(1.0, 0.0, 0.0))
    .translate((-(L_BALL + 37.2) + SAFETY_X, 28.0 + (0.0 if pin_in else 72.0), -11.5 + SAFETY_Z))
    .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
    .translate((0.0, 0.0, Z_PIV), name="safety_pin")
)
safety_pin.material(preset=preset.steel, color="#d63031")

# Golf Ball: rides in cup for stroke <= 1.0, then launches ~340 mm (8 ball diameters) so mechanism stays large & crisp in frame!
er_b = (math.cos(alpha_arm), math.sin(alpha_arm))
et_b = (math.sin(alpha_arm), -math.cos(alpha_arm))
bx0 = L_BALL * er_b[0] + 19.95 * et_b[0]
bz0 = Z_PIV + L_BALL * er_b[1] + 19.95 * et_b[1]
ft = math.clamp((stroke - 1.0) * 0.105, 0.0, 0.044)
v0 = 7850.0
bx = bx0 + v0 * math.cos(launch_deg) * ft
bz = bz0 + v0 * math.sin(launch_deg) * ft - 0.5 * 9806.65 * ft * ft
ball = sphere(21.335, center=(bx, 0.0, bz), name="regulation_golf_ball")
ball.material(preset=preset.abs, color="#f5f6fa", roughness=0.24, texture="dots", scale=4.2)

animation("full_mechanism_and_ball_launch", [
    keyframe(0.0, stroke=-0.25, camera=view(az=34, el=15), ease=ease.linear),
    keyframe(0.55, stroke=-0.12, camera=view(az=32, el=15), ease=ease.linear),
    keyframe(1.25, stroke=0.0, camera=view(az=28, el=14), ease=ease.ease_in),
    keyframe(2.55, stroke=1.0, camera=view(az=18, el=13), ease=ease.linear),
    keyframe(3.65, stroke=1.42, camera=view(az=12, el=12)),
], fps=20, loop=True)


def check_full_system_and_trigger_clearance():
    assert_solid(carrier_posed)
    # Enforce that all 3 mousetrap bases + sear bridge + rear fairlead sit flat & flush on cradle!
    for flush_part in traps_wood + [trig_posed[0], trig_posed[2]]:
        df = distance(flush_part, cradle)
        assert_true(not df.overlap, msg="%s interpenetrates mounting board at %s" % (flush_part.name, df.at))
        assert_true(df.distance < 0.05, msg="%s is not flat/flush against mounting board (gap=%s)" % (flush_part.name, df.distance))
    for bl in bails:
        db = distance(carrier_posed, bl)
        assert_true(not db.overlap, msg="Carrier interferes with exact caliper bail %s at %s" % (bl.name, db.at))
    for sc in m3_screws:
        for obs in traps_wood + [cradle]:
            ds = distance(sc, obs)
            assert_true(not ds.overlap, msg="Screw %s hits %s at stroke=%s" % (sc.name, obs.name, stroke))
    gap = distance(carrier_posed, stop_pad)
    if stroke >= 1.0:
        assert_true(gap.distance < 0.6, msg="Stop pad is %s mm from the truss ribs at the stop" % gap.distance)
    for obs in traps_wood + [cradle, stand_base, leg_l, leg_r, stop_pad, stop_riser, safety_pin] + trig_posed:
        d = distance(carrier_posed, obs)
        assert_true(not d.overlap, msg="Carrier hits %s at stroke=%s (%s)" % (obs.name, stroke, d.at))
        dball = distance(ball, obs)
        assert_true(not dball.overlap, msg="Golf ball hits %s at stroke=%s (%s)" % (obs.name, stroke, dball.at))
    return carrier_posed.volume()


test("flat-mounted traps + trigger pull + sweep to padded stop + ball flight clearance", check_full_system_and_trigger_clearance, sweep={"stroke": [-0.25, -0.06, 0.0, 0.03, 0.25, 0.5, 0.75, 1.0, 1.3]})
