# MTC-180 v5 drive-cord kinematics, shared by the assembly and (by value) analysis/cam_launch_sim.py.
# Side view, X forward, Z up, degrees.  Cord path: coupler eye -> under the roller -> cord post on the arm horn.

XH = 112.0            # trap hinge line
R_ROLL_EFF = 6.85     # roller V-waist radius 5.9 + cord radius 0.95
TH_REST = 7.0         # bails on the front landing pad
TH_MAX = 173.0        # bails folded flat back onto the traps
TH_COCK_FULL = 165.0  # the cord is tied so that notch 6 holds the bails here


def _tangent(qx, qz, cx, cz, side):
    # Tangent from point q to the roller: (length, polar angle of the touch point seen from the roller centre).
    dx, dz = qx - cx, qz - cz
    dist = math.sqrt(dx * dx + dz * dz)
    ang = math.atan2(dz, dx) + side * math.acos(R_ROLL_EFF / dist)
    return math.sqrt(dist * dist - R_ROLL_EFF * R_ROLL_EFF), ang


def cord_path(th, psi, g):
    # g: dict(zh, r_pull, xp, zp, xr, zr, horn_r, horn_a).  Returns (total length, eye, eye touch angle, post, post touch angle).
    ex, ez = XH + g["r_pull"] * math.cos(th), g["zh"] + g["r_pull"] * math.sin(th)
    px, pz = g["xp"] + g["horn_r"] * math.cos(g["horn_a"] - psi), g["zp"] + g["horn_r"] * math.sin(g["horn_a"] - psi)
    lb, ab = _tangent(ex, ez, g["xr"], g["zr"], -1.0)
    lh, ah = _tangent(px, pz, g["xr"], g["zr"], 1.0)
    wrap = (ab - ah) % 360.0
    return lb + lh + R_ROLL_EFF * wrap * math.pi / 180.0, (ex, ez), ab, (px, pz), ah


def bail_angle(psi, cord, g):
    # Bail angle for a taut cord of the given length with the arm at psi (bisection; length falls as th rises).
    if cord_path(TH_REST, psi, g)[0] <= cord:
        return TH_REST          # bails already on the pad: cord slack
    lo, hi = TH_REST, TH_MAX
    if cord_path(hi, psi, g)[0] > cord:
        return TH_MAX
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if cord_path(mid, psi, g)[0] > cord:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)
