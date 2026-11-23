# MTC-180 Direct-Drive Arm: hook sear + clevis bracket + padded stop wedge (all screw flat to the floor-flush base)
#
# Sear: a C-hook that pivots on an M4 bolt UNDER the arm's tip tongue and reaches over it. The hook's concave contact
# arc bears on the tongue's rounded ridge and is struck 1.5 mm behind the pivot, so the ~4.5 N latch load passes
# almost through the pivot with a small closing bias; a rearward pull on the string slides the nose off the ridge.
# Nothing is left in the arm's path.

load("bail_coupler.star", "Z_WIRE")
load("direct_arm.star", "rail_top", "rail_crest", "TONGUE_T", "X_LATCH", "RIDGE_R")

R_ARC = 22.0          # nose arc radius
ARC_BACK = 1.5        # arc centre is this far behind the pivot (closing bias)
SEAR_T = 7.0
SEAR_OPEN_DEG = 24.0


def sear_pivot(z_hinge, cock_deg):
    """World (X, Z) of the sear pivot for an arm cocked at cock_deg (0.1 mm running clearance on the ridge)."""
    y = TONGUE_T + Z_WIRE
    cx = X_LATCH * math.cos(cock_deg) + y * math.sin(cock_deg)
    cz = z_hinge + X_LATCH * math.sin(cock_deg) - y * math.cos(cock_deg)
    reach = R_ARC - RIDGE_R - 0.1
    return cx - reach * math.sin(cock_deg) + ARC_BACK, cz + reach * math.cos(cock_deg)


PIVOT_H = sear_pivot(29.5, 173.0)[1] - 18.0   # pivot above the base top for the 18 mm base and 173 deg cock


def _teardrop_xz(sk, cx, cz, r):
    s = r * 0.7071
    return sk.polygon([
        (cx, cz + r * 1.414), (cx + s, cz + s), (cx + r, cz), (cx + s, cz - s),
        (cx, cz - r), (cx - s, cz - s), (cx - r, cz), (cx - s, cz + s),
    ])


def build_sear_hook(name="mtc180_sear_hook"):
    # Printed flat on its side: sketch X = assembly X (toward the hinge), sketch Y = assembly Z, origin on the pivot.
    pts = [(-7.3, -14.0), (-1.5, -14.0), (5.0, -3.3), (6.0, 0.0), (5.0, 3.3), (2.5, 5.5), (-3.8, 8.5)]
    for i in range(10):
        x = -3.8 + 8.0 * i / 9.0
        pts.append((x, math.sqrt(R_ARC * R_ARC - (x + ARC_BACK) * (x + ARC_BACK))))
    pts.extend([(5.2, 22.4), (5.2, 27.5), (-3.5, 27.5), (-3.5, 38.0), (-10.5, 38.0), (-10.5, 4.0), (-7.3, -4.0)])
    sk = sketch(XY, name=name + "_sk").polygon(pts).circle(2.15, center=(0.0, 0.0)).circle(1.4, center=(-7.0, 34.0))
    hook = extrude(sk, SEAR_T, name=name)
    hook.material(preset=preset.petg_glossy, color="#FCE300", roughness=0.34)
    return hook


def build_sear_bracket(name="mtc180_sear_bracket"):
    # Part frame: origin under the pivot on the base top; +X toward the trap hinge.
    plate = extrude(
        sketch(XY, name=name + "_pl_sk")
        .rect(42.0, 40.0, center=(9.0, 0.0))
        .circle(2.15, center=(22.0, 12.0)).circle(2.15, center=(22.0, -12.0))
        .circle(2.15, center=(-6.0, 15.0)).circle(2.15, center=(-6.0, -15.0)),
        3.4, name=name + "_plate",
    )
    cheeks = [
        box(17.5, 5.0, PIVOT_H + 6.5, at=(-10.5, sgn * 6.7 - 2.5, 0.0), name=name + "_cheek_" + tag)
        for sgn, tag in [(-1.0, "a"), (1.0, "b")]
    ]
    stop_wall = box(3.0, 18.4, 12.0, at=(-10.5, -9.2, 0.0), name=name + "_stop_wall")
    bore = extrude(_teardrop_xz(sketch(XZ.offset(-10.0), name=name + "_bore_sk"), 0.0, PIVOT_H, 2.15), 20.0, name=name + "_bore")
    bracket = subtract([union([plate, stop_wall] + cheeks, kernel=kernel.mesh, name=name + "_u"), bore], kernel=kernel.mesh, name=name)
    bracket.material(preset=preset.petg_glossy, color="#0086D6", roughness=0.34)
    return bracket


STOP_W = 40.0
STOP_DEG = 14.0       # arm (bail) angle at the stop
STOP_X0 = 98.0        # rail stations that land on the pad (around the arm's centre of percussion, ~105 mm)
STOP_X1 = 122.0
PAD_T = 10.0          # soft foam (EVA / mouse-pad stack): the bare arm arrives with ~0.9 J after the ball has left
PAD_GAP = 0.3


def stop_wedge_dims(z_hinge, t_board):
    """(x_front, x_back, h_front, h_back) of the stop wedge in the base frame (hinge at X = 0)."""
    out = []
    for x in [STOP_X0, STOP_X1]:
        y = rail_crest(x) + Z_WIRE
        xw = x * math.cos(STOP_DEG) + y * math.sin(STOP_DEG)
        zw = z_hinge + x * math.sin(STOP_DEG) - y * math.cos(STOP_DEG)
        out.append((xw, zw - t_board - PAD_T - PAD_GAP))
    return out[0][0], out[1][0], out[0][1], out[1][1]


def build_stop_wedge(length, h0, h1, name="mtc180_stop_wedge"):
    # Flat base on the board; top face tilted so both rail crests land flat on the stick-on foam pad.
    blk = extrude(
        sketch(XZ.offset(-STOP_W / 2.0), name=name + "_sk").polygon([(0.0, 0.0), (length, 0.0), (length, h1), (0.0, h0)]),
        STOP_W, name=name + "_blk",
    )
    cuts = []
    for sgn, tag in [(-1.0, "a"), (1.0, "b")]:
        cuts.append(cylinder(2.15, h1 + 0.4, at=(length / 2.0, sgn * 13.0, -0.2), name=name + "_hole_" + tag))
        cuts.append(cylinder(4.0, h1, at=(length / 2.0, sgn * 13.0, 4.0), name=name + "_cb_" + tag))
    wedge = subtract([blk] + cuts, kernel=kernel.mesh, name=name)
    wedge.material(preset=preset.petg_glossy, color="#0086D6", roughness=0.34)
    return wedge
