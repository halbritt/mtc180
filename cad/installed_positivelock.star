# Caliper-Exact 3D Fit & Full 180-Deg Clearance Verification against:
#   1) 3x Exact User U-Bails (Ø1.80mm wire, 40.50mm OD = 38.70mm C-to-C, 43.20mm axle-to-inside-wire = 44.10mm centerline!)
#   2) 3x Sloped 98.4 x 46.1 x 8.0 mm Wooden Mousetrap Bases (sloped 3.37 deg so front crossbar touches wood at 0 deg!)
#   3) Wide 200 mm Tilted Cradle Board underneath the 8.0 mm trap bases!
load("carrier_positivelock.star", "build_positivelock_carrier", "L_BALL", "TRAP_PITCH", "WIRE_HALF_CC")

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

# Build exact user U-bails (38.70mm C-to-C, 44.10mm front crossbar centerline, r_bend = 3.0mm, Ø1.80mm wire -> r=0.88mm test clearance)
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

    # Exact 98.4 x 46.1 x 8.0 mm wood base sloped 3.37 deg so front wire bottom (X=44.1, z=-0.90) touches wood at stroke=1!
    tb = (
        box(98.4, 46.1, 8.0, at=(-49.2, yc - 23.05, -11.50), name="tb_" + t)
        .rotate(-3.37, axis=(0.0, 1.0, 0.0), name="tb_slp_" + t)
        .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
        .translate((0.0, 0.0, Z_PIV), name="victor_wood_" + t)
    )
    tb.material(color="#e0bc87", roughness=0.6)
    traps_wood.append(tb)

cradle = (
    box(95.0, 196.0, 10.0, at=(-47.5, -98.0, -21.7), name="cradle_raw")
    .rotate(-3.37, axis=(0.0, 1.0, 0.0))
    .rotate(-alpha_trap_front, axis=(0.0, 1.0, 0.0))
    .translate((0.0, 0.0, Z_PIV), name="tilted_trap_base")
)
cradle.material(color="#c79c6b", roughness=0.55)
stand_base = box(240.0, 236.0, 12.0, at=(-120.0, -118.0, 0.0), name="stand_baseplate")


def check_exact_caliper_fit_and_180_sweep():
    assert_solid(carrier_posed)
    for bl in bails:
        db = distance(carrier_posed, bl)
        assert_true(not db.overlap, msg="Carrier interferes with exact caliper bail %s at %s" % (bl.name, db.at))
    for obs in traps_wood + [cradle, stand_base]:
        d = distance(carrier_posed, obs)
        assert_true(not d.overlap, msg="Carrier hits %s at stroke=%s (%s)" % (obs.name, stroke, d.at))
    return carrier_posed.volume()


test("exact 40.5x43.2mm bail fit + sloped 98.4x46.1mm wood clearance across 180 deg", check_exact_caliper_fit_and_180_sweep, sweep={"stroke": [0.0, 0.25, 0.5, 0.75, 1.0]})
