# MTC-180 Direct-Drive Rail Arm: bolts straight onto the 3-bail coupler (no cord, cam, pivot or stanchions)
#
# With the traps flat on a floor-flush base, a ball held rigidly in a cup can only be thrown upward during the
# first ~60 deg of bail travel. This arm instead lets the ball ROLL outward along two rails while the bails
# swing: the outward (radial) speed adds to the tangential speed, so the ball leaves the tip heading ~30 deg
# upward when the arm is only ~10 deg short of vertical, after about 90 deg of spring stroke.
#
# Part frame (also the print frame, zero supports):
#   X = radial distance from the trap hinge axis, Y = across the traps,
#   Z = 0 is the bed face, which seats on the coupler's flat Z = 0 driven face; +Z is the LEADING side (ball side).
#   The bail-wire plane is therefore at Z = -Z_WIRE (inside the coupler).

load("bail_coupler.star", "X_MIN", "X_M4", "M4_YS", "Z_WIRE")

BALL_R = 21.335
L_TIP = 200.0        # rail tip (ball leaves here)
RAIL_HALF_IN = 6.0   # ball rides on the two inner top edges, 12 mm apart
RAIL_T = 2.0
FLOOR_T = 2.2
FOOT_T = 3.0
BOSS_H = 5.5         # M4 x 10 through washer + 4.0 mm coupler shelf leaves 5 mm of thread in the arm
X_FOOT_END = 53.5
HZ_FOOT = 7.0        # rail-top height over the trap wood (keeps the rest angle low)
HZ_ROOT = 16.0       # rail-top height at X_RISE1
HZ_TIP = 6.0         # rail-top height at the tip
X_RISE0 = 47.0
X_RISE1 = 57.0
RIDE_H = 20.47       # ball centre above the rail edges: sqrt(BALL_R^2 - RAIL_HALF_IN^2)
TONGUE_X1 = 209.0    # sear tongue end
TONGUE_T = 3.2
X_LATCH = 205.5      # sear contact station on the tongue
RIDGE_R = 1.6        # rounded latch ridge on the tongue (the sear's concave arc bears on it)
PEG_X0 = 61.0        # first backstop hole (its screw head clears the coupler lug that ends at X = 56.5)
PEG_PITCH = 10.0
PEG_COUNT = 10
BLOCK_LEN = 12.0
BLOCK_W = 11.6
BLOCK_TOP = 20.0     # backstop top, part Z (4 mm above the rail root)
BLOCK_HOLE_OFF = 3.5  # pilot is 3.5 mm from one face and 8.5 mm from the other: flip the block for 5 mm half-steps


def rail_top(x):
    """Rail-top height (part Z) at radial station x."""
    if x <= X_RISE0:
        return HZ_FOOT
    if x <= X_RISE1:
        return HZ_FOOT + (HZ_ROOT - HZ_FOOT) * (x - X_RISE0) / (X_RISE1 - X_RISE0)
    return HZ_ROOT + (HZ_TIP - HZ_ROOT) * (x - X_RISE1) / (L_TIP - X_RISE1)


def ball_start_x(peg_index, flipped=False):
    """Radial station of the ball centre when it rests against the backstop in hole peg_index (0-based)."""
    x_face = PEG_X0 + PEG_PITCH * peg_index + (BLOCK_LEN - BLOCK_HOLE_OFF if flipped else BLOCK_HOLE_OFF)
    x = x_face + 13.0
    for _ in range(6):
        dz = rail_top(x) + RIDE_H - BLOCK_TOP
        x = x_face + math.sqrt(BALL_R * BALL_R - dz * dz)
    return x


def build_direct_arm(name="mtc180_direct_arm", layer=None):
    foot = box(X_FOOT_END - X_MIN, 133.0, FOOT_T, at=(X_MIN, -66.5, 0.0), name=name + "_foot")
    floor = box(L_TIP - X_MIN, 16.0, FLOOR_T, at=(X_MIN, -8.0, 0.0), name=name + "_floor")
    gusset = extrude(
        sketch(XY, name=name + "_gus_sk").polygon([(X_FOOT_END - 0.5, -40.0), (82.0, -8.0), (82.0, 8.0), (X_FOOT_END - 0.5, 40.0)]),
        FLOOR_T, name=name + "_gusset",
    )
    tongue = box(TONGUE_X1 - L_TIP + 1.0, 12.0, TONGUE_T, at=(L_TIP - 1.0, -6.0, 0.0), name=name + "_tongue")
    ridge_pts = [(X_LATCH + RIDGE_R * math.cos(a), TONGUE_T - 0.01 + RIDGE_R * math.sin(a)) for a in range(0, 181, 20)]
    ridge = extrude(sketch(XZ.offset(-6.0), name=name + "_ridge_sk").polygon(ridge_pts), 12.0, name=name + "_ridge")
    web_pts = [(X_MIN, 0.0), (L_TIP, 0.0), (L_TIP, HZ_TIP), (X_RISE1, HZ_ROOT), (X_RISE0, HZ_FOOT), (X_MIN, HZ_FOOT)]
    web_a = extrude(sketch(XZ.offset(-(RAIL_HALF_IN + RAIL_T)), name=name + "_wa_sk").polygon(web_pts), RAIL_T, name=name + "_web_a")
    web_b = extrude(sketch(XZ.offset(RAIL_HALF_IN), name=name + "_wb_sk").polygon(web_pts), RAIL_T, name=name + "_web_b")
    bosses = [cylinder(5.0, BOSS_H, at=(X_M4, y_m, 0.0), name=name + "_boss_" + str(i)) for i, y_m in enumerate(M4_YS)]

    cutters = [cylinder(1.75, BOSS_H + 0.4, at=(X_M4, y_m, -0.2), name=name + "_pilot_" + str(i)) for i, y_m in enumerate(M4_YS)]
    # Level seat for the backstop where the 3.0 mm foot would otherwise stand proud of the 2.2 mm rail floor
    cutters.append(box(X_FOOT_END - 45.0 + 0.2, 2.0 * RAIL_HALF_IN, 2.0, at=(45.0, -RAIL_HALF_IN, FLOOR_T), name=name + "_seat"))
    for k in range(PEG_COUNT):
        cutters.append(cylinder(2.15, FLOOR_T + 0.4, at=(PEG_X0 + PEG_PITCH * k, 0.0, -0.2), name=name + "_peg_" + str(k)))

    arm = subtract(
        [union([foot, floor, gusset, tongue, ridge, web_a, web_b] + bosses, kernel=kernel.mesh, name=name + "_u")] + cutters,
        kernel=kernel.mesh, name=name,
    )
    if layer != None:
        layer.add(arm)
    arm.material(preset=preset.petg_glossy, color="#00b894", roughness=0.32)
    return arm


def build_ball_backstop(name="mtc180_ball_backstop"):
    # Sits between the rails on the floor; one M4 x 10 from underneath self-taps into the 3.5 mm pilot.
    # Part frame: X = 0 is the face nearest the pilot, Z = 0 is the face on the rail floor.
    h = BLOCK_TOP - FLOOR_T
    blk = box(BLOCK_LEN, BLOCK_W, h, at=(0.0, -BLOCK_W / 2.0, 0.0), name=name + "_blk")
    pilot = cylinder(1.75, 12.0, at=(BLOCK_HOLE_OFF, 0.0, -0.2), name=name + "_pilot")
    block = subtract([blk, pilot], kernel=kernel.mesh, name=name)
    block.material(preset=preset.petg_glossy, color="#e17055", roughness=0.34)
    return block
