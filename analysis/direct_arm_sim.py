"""Launch model for the MTC-180 direct-drive rail arm (cad/direct_arm.star).

Two degrees of freedom: bail/arm travel phi and ball distance s along the straight rail.
The arm is rigid; the ball either rolls without slipping on the two rail edges or slides
without friction (the two limits of what the real ball can do). Spring torque falls linearly
from the cocked value to `ratio` times that at rest; total spring energy over 180 deg is `E`.

ASSUMPTIONS THAT ARE NOT MEASURED: E = 2.12 J for three traps (the repo's working figure) and
ratio = 0.5. Measure the traps (pull the bail with a luggage scale at 0/90/180 deg) and rerun.

    uv run --with numpy --with scipy python3 analysis/direct_arm_sim.py
"""
import numpy as np
from scipy.integrate import solve_ivp

G = 9.81
M_BALL = 0.04593
A = 0.021335
RIDE_H = float(np.sqrt(A * A - 0.006 ** 2))   # ball centre above the rail edges (12 mm apart)
Z_WIRE = 0.00295
# Geometry copied from cad/direct_arm.star (metres)
L_TIP, X_RISE1, HZ_ROOT, HZ_TIP = 0.200, 0.057, 0.016, 0.006
PEG_X0, PEG_PITCH, PEG_COUNT = 0.061, 0.010, 10
BLOCK_LEN, BLOCK_HOLE_OFF, BLOCK_TOP = 0.012, 0.0035, 0.0200
# Layout from cad/installed_direct.star
TH_COCK, TH_STOP = np.radians(173.0), np.radians(14.0)
Z_HINGE = 0.0295                                # hinge axis above the floor
# Rotating mass about the hinge: printed arm (solid PETG, from the exported STL) + coupler + bails + 6 screws + backstop
I_ARM, MX_ARM = 2.63e-4, 2.37e-3
I_FIXED, MX_FIXED = 0.40e-4 + 0.08e-4 + 0.11e-4, 0.016 * 0.042 + 0.009 * 0.035
M_BLOCK = 0.0057

GAMMA = float(np.arctan((HZ_ROOT - HZ_TIP) / (L_TIP - X_RISE1)))   # rail slope relative to the arm


def rail_top(x):
    return HZ_ROOT + (HZ_TIP - HZ_ROOT) * (x - X_RISE1) / (L_TIP - X_RISE1)


def ball_start_x(peg, flipped=False):
    x_face = PEG_X0 + PEG_PITCH * peg + ((BLOCK_LEN - BLOCK_HOLE_OFF) if flipped else BLOCK_HOLE_OFF)
    x = x_face + 0.013
    for _ in range(8):
        dz = rail_top(x) + RIDE_H - BLOCK_TOP
        x = x_face + np.sqrt(A * A - dz * dz)
    return float(x)


def spring(E=2.12, ratio=0.5):
    tc = E / (np.pi * (1 + ratio) / 2)
    k = tc * (1 - ratio) / np.pi
    return lambda phi: tc - k * (phi + np.radians(7.0))


def launch(x0, roll=True, E=2.12, ratio=0.5, trace=False):
    """Simulate one shot with the ball starting at radial station x0. Returns a dict of release conditions."""
    tau = spring(E, ratio)
    y0 = Z_WIRE + rail_top(x0) + RIDE_H
    xb = x0 - 0.020
    inertia = I_ARM + I_FIXED + M_BLOCK * xb * xb
    mx = MX_ARM + MX_FIXED + M_BLOCK * xb
    ib = 0.4 * M_BALL * A * A if roll else 0.0
    ae = RIDE_H
    cg, sg = np.cos(GAMMA), np.sin(GAMMA)
    s_end = (L_TIP - x0) / cg
    ms = M_BALL + ib / ae ** 2

    def rhs(_t, y):
        p, s, pd, sd = y
        th = TH_COCK - p
        x, yy = x0 + s * cg, y0 - s * sg
        a_, as_ = x * x + yy * yy, 2 * (x * cg - yy * sg)
        b_ = -x * sg - yy * cg
        c = M_BALL * b_ - ib / ae
        mm = np.array([[inertia + M_BALL * a_ + ib, c], [c, ms]])
        qp = tau(p) + M_BALL * G * (x * np.cos(th) + yy * np.sin(th)) + mx * G * np.cos(th)
        qs = -M_BALL * G * (cg * np.sin(th) + sg * np.cos(th))
        acc = np.linalg.solve(mm, np.array([qp - M_BALL * as_ * sd * pd, qs + 0.5 * M_BALL * as_ * pd * pd]))
        if s <= 1e-9 and sd <= 0 and acc[1] <= 0:      # still resting against the backstop
            return [pd, 0.0, qp / (inertia + M_BALL * a_ + ib), 0.0]
        return [pd, sd, acc[0], acc[1]]

    off_tip = lambda _t, y: y[1] - s_end
    off_tip.terminal = True
    at_stop = lambda _t, y: y[0] - (TH_COCK - TH_STOP)
    at_stop.terminal = True
    sol = solve_ivp(rhs, [0, 1], [0, 0, 0, 0], events=[off_tip, at_stop], max_step=2e-4, rtol=1e-8)
    p, s, pd, sd = sol.y[:, -1]
    th = TH_COCK - p
    x, yy = x0 + s * cg, y0 - s * sg
    er, et = np.array([np.cos(th), np.sin(th)]), np.array([np.sin(th), -np.cos(th)])
    v = (sd * cg - pd * yy) * er + (-sd * sg + pd * x) * et
    pos = x * er + yy * et
    left = len(sol.t_events[0]) > 0
    z = Z_HINGE + pos[1]
    carry = pos[0] + v[0] * (v[1] + np.sqrt(max(v[1] ** 2 + 2 * G * z, 0.0))) / G if left else 0.0
    out = dict(left=left, theta=float(np.degrees(th)), speed=float(np.hypot(*v)), elev=float(np.degrees(np.arctan2(v[1], v[0]))),
               carry=float(carry), t=float(sol.t[-1]), omega=float(pd), ke_ball=float(0.5 * M_BALL * v @ v))
    if trace:
        out["trace"] = (np.degrees(TH_COCK - sol.y[0]), sol.y[1])
    return out


if __name__ == "__main__":
    print("rail slope %.2f deg, ride height %.2f mm" % (np.degrees(GAMMA), RIDE_H * 1e3))
    print("hole flip  x0(mm) | rolling: rel.angle elev speed carry | sliding: elev carry | E-20%% carry | E+20%% carry")
    for peg in range(PEG_COUNT):
        for flipped in (False, True):
            x0 = ball_start_x(peg, flipped)
            r, sl = launch(x0), launch(x0, roll=False)
            lo, hi = launch(x0, E=1.70), launch(x0, E=2.54)
            print("  %d   %s   %6.1f |   %5.1f  %5.1f  %4.2f  %4.2f |  %5.1f  %4.2f |  %4.2f |  %4.2f" % (
                peg + 1, "B" if flipped else "A", x0 * 1e3, r["theta"], r["elev"], r["speed"], r["carry"],
                sl["elev"], sl["carry"], lo["carry"], hi["carry"]))
    x0 = ball_start_x(0)
    r = launch(x0, trace=True)
    th, s = r["trace"]
    idx = np.linspace(0, len(th) - 1, 13).astype(int)
    print("animation table (hole 1A): theta_deg -> s_mm")
    print("  TH = [%s]" % ", ".join("%.1f" % th[i] for i in idx))
    print("  S  = [%s]" % ", ".join("%.1f" % (s[i] * 1e3) for i in idx))
    print("release: theta %.1f deg, speed %.2f m/s, elevation %.1f deg, arm rate %.1f rad/s, ball KE %.2f J, t %.0f ms" % (
        r["theta"], r["speed"], r["elev"], r["omega"], r["ke_ball"], r["t"] * 1e3))
    for ratio in (0.3, 0.7):
        print("spring ratio %.1f: carry %.2f m" % (ratio, launch(x0, ratio=ratio)["carry"]))
