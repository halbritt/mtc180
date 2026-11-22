# Caliper-Exact 3D Fit & Full 180-Deg Clearance Verification WITH Wood-Board Trigger Mechanism:
#   1) 3x Exact User U-Bails (Ø1.80mm wire, 40.50mm OD = 38.70mm C-to-C, 43.20mm axle-to-inside-wire)
#   2) 3x Sloped 98.4 x 46.1 x 8.0 mm Wooden Mousetrap Bases (factory triggers removed)
#   3) Extended 240 x 204 mm Adjustable Trajectory Wood Board (x_L = -190..+50 mm)
#   4) Front Coaxial Over-Center Sear + Outboard Y=+83mm Pull-String Lever + Rear String Guide!
load("carrier_positivelock.star", "build_positivelock_carrier", "L_BALL", "TRAP_PITCH", "WIRE_HALF_CC")
load("trigger_mechanism.star", "pose_trigger_local")

launch_deg = param("launch_deg", 74.6, unit="deg", min=10.0, max=80.0)
stroke = param("stroke", 0.0, min=0.0, max=1.4, step=0.02)

Z_PIV = 215.0
sweep_t = math.clamp(stroke, 0.0, 1.0)
theta_bail = 180.0 * (1.0 - sweep_t)
alpha_trap_front = launch_deg + 90.0
alpha_arm = alpha_trap_front + theta_bail

raw_carrier = build_positivelock_carrier(name="poslock_raw")
carrier_posed = (
    raw_carrier
    .translate((0.0, 0.0, -3.05), name="car_centered")
    .rotate(180.0, axis=(1.0, 0.0, 0.0), name="car_flip")
    .rotate(-alpha_arm, axis=(0.0, 1.0, 0.0), name="car_rot")
    .translate((0.0, 0.0, Z_PIV), name="mtc180_poslock_posed")
)

bails = []
traps_wood = []
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

    tb = (
        box(98.4, 46.1, 8.0, at=(-49.2, yc - 23.05, -11.50), name="tb_" + t)
        .rotate(-3.37, axis=(0.0, 1.0, 0.0), name="tb_slp_" + t)
        .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
        .translate((0.0, 0.0, Z_PIV), name="victor_wood_" + t)
    )
    tb.material(color="#e0bc87", roughness=0.6)
    traps_wood.append(tb)

# Extended 240 x 204 x 12 mm Trajectory Board (translucent in CAD so underside sear, bails & pull string are clearly visible!)
cradle = (
    box(240.0, 204.0, 12.0, at=(-190.0, -102.0, -23.5), name="cradle_raw")
    .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
    .translate((0.0, 0.0, Z_PIV), name="adjustable_trajectory_board")
)
cradle.material(color="#c79c6b", roughness=0.45, opacity=0.32)

er_b = (math.cos(alpha_arm), math.sin(alpha_arm))
et_b = (math.sin(alpha_arm), -math.cos(alpha_arm))
ball = sphere(21.335, center=(L_BALL * er_b[0] + 19.95 * et_b[0], 0.0, Z_PIV + L_BALL * er_b[1] + 19.95 * et_b[1]), name="regulation_golf_ball")
ball.material(preset=preset.abs, color="#f5f6fa", roughness=0.26)

# Trigger parts: latched (0 deg) at stroke=0.0; pulled to 20 deg open as soon as stroke > 0!
sear_deg = math.clamp(stroke * 1000.0, 0.0, 1.0) * 20.0
br_l, rk_l, fl_l, str_l = pose_trigger_local(L_BALL, sear_deg)
trig_posed = [
    p.rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0)).translate((0.0, 0.0, Z_PIV), name="posed_" + p.name)
    for p in [br_l, rk_l, fl_l, str_l]
]
stand_base = box(280.0, 240.0, 12.0, at=(-140.0, -120.0, 0.0), name="stand_baseplate")


def check_full_system_and_trigger_clearance():
    assert_solid(carrier_posed)
    for bl in bails:
        db = distance(carrier_posed, bl)
        assert_true(not db.overlap, msg="Carrier interferes with exact caliper bail %s at %s" % (bl.name, db.at))
    for obs in traps_wood + [cradle, stand_base] + trig_posed:
        d = distance(carrier_posed, obs)
        assert_true(not d.overlap, msg="Carrier hits %s at stroke=%s (%s)" % (obs.name, stroke, d.at))
    return carrier_posed.volume()


test("180-deg sweep + front sear + rear pull-string clearance", check_full_system_and_trigger_clearance, sweep={"stroke": [0.0, 0.03, 0.25, 0.5, 0.75, 1.0]})
