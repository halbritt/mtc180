"""Launch model of the v5 floor-flush catapult, using the exact cord path.

Cord path (side view, X forward, Z up): coupler eye -> under the roller -> cord
post on the arm's horn.  Both ends are cranks: the bail eye swings about the
trap hinge, the horn post swings about the arm pivot and reaches dead centre
(post, pivot and roller in line) just past the arm stop.  The cord cannot
stretch and can only pull, so the model is a hybrid: while the cord is taut the
bails and the arm are one 1-DOF mechanism; if the arm would have to slow down
to stay on the cord, the cord goes slack and the arm coasts.

`--cam R` runs the same model for the previous design, a circular cam of
effective radius R on the arm (cord wraps the cam, constant lever arm).

Spring model is ASSUMED, not measured: 2.12 J for three traps over 180 deg,
torque linear in angle, rest torque = 0.5 x cocked torque.  Nothing here has
been printed or fired.

    mise run camsim                                # range table for the geometry in cad/*.star
    mise run camsim -- --cam 96.5 --th-cock 156    # the old cam, as it was drawn
"""
import argparse
import math
import pathlib
import re

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _const(path, name):
    m = re.search(r"^%s\s*=\s*(?:param\([^,]+,\s*)?(-?[0-9.]+)" % name, (ROOT / path).read_text(), re.M)
    return float(m.group(1))


# Geometry, read from the CAD sources so the two cannot drift apart.
T_BOARD = _const("cad/stanchion_trigger.star", "T_BOARD")
XH, ZH = _const("cad/linkage.star", "XH"), T_BOARD + 8.0 + 3.5
R_PULL = _const("cad/bail_coupler.star", "R_PULL")
XP, ZP = _const("cad/stanchion_trigger.star", "XP"), _const("cad/stanchion_trigger.star", "ZP")
XR, ZR = _const("cad/stanchion_trigger.star", "XR"), _const("cad/stanchion_trigger.star", "ZR")
HORN_R, HORN_A = _const("cad/throwing_arm.star", "HORN_R"), _const("cad/throwing_arm.star", "HORN_A")
L_BALL = _const("cad/throwing_arm.star", "L_BALL")
R_ROLL_EFF = _const("cad/linkage.star", "R_ROLL_EFF")
TH_COCK_FULL = _const("cad/linkage.star", "TH_COCK_FULL")
TH_REST, TH_MAX = _const("cad/linkage.star", "TH_REST"), _const("cad/linkage.star", "TH_MAX")
NOTCH_PSIS = [float(x) for x in re.search(r"^NOTCH_PSIS\s*=\s*\[([^\]]+)\]", (ROOT / "cad/throwing_arm.star").read_text(), re.M).group(1).split(",")][::-1]

M_BALL = 0.04593
R_BALL_PIVOT = math.hypot(L_BALL + 1.30, 1.30) * 1e-3    # ball centre from the arm pivot
I_BAIL = 0.319e-4 + 0.08e-4 + 0.18e-4                    # coupler (FEA) + 3 steel bails + 6 M4 screws/washers
# Sliced 12 mm horn arm (2 walls, 15% gyroid): mass kg, inertia about pivot kg m^2, c.g. in arm frame mm,
# plus through-bolted M4 x 16 screw + fender washer + hex nut (4.0 g) on the cord post.
ARM_HORN_MASS, ARM_HORN_I = 0.0554, 3.980e-4
ARM_HORN = (ARM_HORN_MASS + 0.0040, ARM_HORN_I + 0.0040 * (HORN_R * 1e-3) ** 2, (-22.0, 6.0))
ARM_CAM = (0.072, 6.096e-4, (-26.2, 22.2))               # the previous cam arm (README at d898349)
E_SPRING, RATIO = 2.12, 0.5
G = 9.80665

C = np.array([XR, ZR])
P = np.array([XP, ZP])
H = np.array([XH, ZH])


def spring_torque(th_deg, e=E_SPRING, ratio=RATIO):
    tc = e / (math.pi * (1 + ratio) / 2)
    return tc * (ratio + (1 - ratio) * th_deg / 180.0)


def spring_work(th_from, th_to, e=E_SPRING, ratio=RATIO):
    return 0.5 * (spring_torque(th_from, e, ratio) + spring_torque(th_to, e, ratio)) * math.radians(th_from - th_to)


def _tangent(q, side):
    """Tangent from point q to the roller: (length, polar angle of the touch point, unit vector q -> touch)."""
    d = q - C
    dist = math.hypot(*d)
    ang = math.atan2(d[1], d[0]) + side * math.acos(R_ROLL_EFF / dist)
    span = math.sqrt(dist * dist - R_ROLL_EFF ** 2)
    touch = C + R_ROLL_EFF * np.array([math.cos(ang), math.sin(ang)])
    return span, ang, (touch - q) / span


def bail_side(th_deg):
    """Eye -> roller: (length, touch angle, lever arm of the cord about the hinge, mm)."""
    t = math.radians(th_deg)
    eye = H + R_PULL * np.array([math.cos(t), math.sin(t)])
    span, ang, u = _tangent(eye, -1)
    r = eye - H
    return span, ang, r[0] * u[1] - r[1] * u[0]


def horn_side(psi_deg, rho=HORN_R, alpha=HORN_A):
    """Roller -> cord post: (length, touch angle, lever arm about the arm pivot, mm; > 0 drives the arm)."""
    a = math.radians(alpha - psi_deg)
    post = P + rho * np.array([math.cos(a), math.sin(a)])
    span, ang, u = _tangent(post, +1)
    r = post - P
    return span, ang, r[1] * u[0] - r[0] * u[1]


def cam_side(psi_deg, r_cam):
    """Roller -> circular cam of radius r_cam (crossed tangent), wrap measured to a fixed mark on the cam."""
    d = C - P
    dist = math.hypot(*d)
    phi = math.atan2(d[1], d[0]) + math.acos((r_cam + R_ROLL_EFF) / dist)
    span = math.sqrt(dist * dist - (r_cam + R_ROLL_EFF) ** 2)
    return span + r_cam * math.radians(123.0 - (math.degrees(phi) + psi_deg)), phi + math.pi, r_cam


def cord_len(th_deg, psi_deg, cam=None):
    lb, ab, _ = bail_side(th_deg)
    lh, ah, _ = cam_side(psi_deg, cam) if cam else horn_side(psi_deg)
    return lb + lh + R_ROLL_EFF * ((ab - ah) % (2 * math.pi))


class Linkage:
    """Cord of fixed length between the bails and the arm.  Give the cord length, or th_cock at psi_cock."""

    def __init__(self, psi_cock=NOTCH_PSIS[5], psi_stop=48.0, cord=None, th_cock=TH_COCK_FULL, cam=None, arm=None):
        self.psi_cock, self.psi_stop, self.cam = psi_cock, psi_stop, cam
        self.arm = arm or (ARM_CAM if cam else ARM_HORN)
        self.cord = cord if cord is not None else cord_len(th_cock, psi_cock, cam)
        ths = np.arange(TH_REST, TH_MAX + 1e-9, 0.02)
        lb = np.array([cord_len(t, 0.0, cam) for t in ths])            # falls as th rises
        psis = np.arange(psi_cock, psi_stop + 20.0, 0.02)
        need = self.cord - (np.array([cord_len(TH_REST, p, cam) for p in psis]) - lb[0])
        # usable branch: arm side still paying out (lever > 0) and bails between flat-back and the pad
        lev_h = np.array([(cam_side(p, cam) if cam else horn_side(p))[2] for p in psis])
        n = len(psis)
        bad = np.where((lev_h <= 0.5) | (need > lb[0]) | (need < lb[-1]))[0]
        self.reachable = not (len(bad) and bad[0] == 0)
        if len(bad):
            n = bad[0]
        self.psi_dead = psis[np.argmax(lev_h <= 0.5)] if np.any(lev_h <= 0.5) else float("nan")
        self.psis = psis[:n]
        self.th_of = np.interp(need[:n], lb[::-1], ths[::-1])
        lev_b = np.array([bail_side(t)[2] for t in self.th_of])
        self.lev_b, self.lev_h = lev_b, lev_h[:n]
        self.h1 = -self.lev_h / lev_b if n else np.array([])           # d th / d psi
        self.h2 = np.gradient(self.h1, np.radians(self.psis)) if n > 2 else np.zeros(n)
        self.th_cock = float(self.th_of[0]) if n else float("nan")

    def run(self, e=E_SPRING, ratio=RATIO, dt=4e-6):
        if not self.reachable or len(self.psis) < 5:
            return None
        m_arm, i_arm, cg = self.arm
        i_arm = i_arm + M_BALL * R_BALL_PIVOT ** 2

        def grav(psi):
            c, s = math.cos(math.radians(psi)), math.sin(math.radians(psi))
            return G * (M_BALL * R_BALL_PIVOT * c + m_arm * (-cg[0] * c - cg[1] * s) * 1e-3)

        psi, w, th, wb = self.psi_cock, 0.0, self.th_cock, 0.0
        taut, slack_at, t_max, t = True, None, 0.0, 0.0
        psi_end = self.psis[-1]
        while psi < self.psi_stop and t < 0.5:
            tq = spring_torque(th, e, ratio) if th > TH_REST else 0.0
            if taut and psi < psi_end and th > TH_REST:
                h1 = float(np.interp(psi, self.psis, self.h1))
                h2 = float(np.interp(psi, self.psis, self.h2))
                acc = (tq * -h1 - grav(psi) - I_BAIL * h1 * h2 * w * w) / (i_arm + I_BAIL * h1 * h1)
                if i_arm * acc + grav(psi) <= 0.0 and w > 1.0:      # cord would have to push
                    taut, slack_at = False, slack_at or (th, psi)
                    continue
                lev_b = float(np.interp(psi, self.psis, self.lev_b)) * 1e-3
                t_max = max(t_max, (tq + I_BAIL * (h1 * acc + h2 * w * w)) / lev_b)
                w += acc * dt
                psi += math.degrees(w * dt)
                th = float(np.interp(psi, self.psis, self.th_of))
                wb = h1 * w
            else:
                if taut:
                    taut, slack_at = False, slack_at or (th, psi)
                w -= grav(psi) / i_arm * dt
                psi += math.degrees(w * dt)
                if th > TH_REST:
                    wb -= tq / I_BAIL * dt
                    th = max(TH_REST, th + math.degrees(wb * dt))
                    if psi < psi_end and th < float(np.interp(psi, self.psis, self.th_of)):
                        h1 = float(np.interp(psi, self.psis, self.h1))
                        if wb < h1 * w:                           # bails overrun the arm: cord snaps taut
                            w = (i_arm * w + I_BAIL * h1 * wb) / (i_arm + I_BAIL * h1 * h1)
                            wb, taut = h1 * w, True
                            th = float(np.interp(psi, self.psis, self.th_of))
                if w <= 0.0:
                    break
            t += dt
        return dict(v=w * R_BALL_PIVOT, th_cock=self.th_cock, slack=slack_at, th_end=th, reached=psi >= self.psi_stop,
                    t=t, tension=t_max, work=spring_work(self.th_cock, TH_REST, e, ratio))


def carry(v, elev_deg, h0):
    a = math.radians(elev_deg)
    vz, vx = v * math.sin(a), v * math.cos(a)
    return vx * (vz + math.sqrt(vz * vz + 2 * G * h0)) / G


def release_height(psi_stop):
    return (ZP + R_BALL_PIVOT * 1e3 * math.sin(math.radians(psi_stop))) * 1e-3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cam", type=float, default=None, help="model a circular cam of this effective radius instead of the horn")
    ap.add_argument("--th-cock", type=float, default=TH_COCK_FULL, help="bail angle held by notch 6 (sets the cord length)")
    ap.add_argument("--stops", type=int, nargs="*", default=[42, 50, 58])
    a = ap.parse_args()
    ref = Linkage(th_cock=a.th_cock, cam=a.cam)
    what = "circular cam, R_eff %.1f mm" % a.cam if a.cam else "cord horn, post at %.1f mm / %.1f deg (dead centre at arm %.1f deg)" % (HORN_R, HORN_A, ref.psi_dead)
    print("%s; cord tied so notch 6 holds the bails at %.1f deg" % (what, a.th_cock))
    print("arm: %.1f g, %.3f kg cm^2 about the pivot; bails + coupler %.3f kg cm^2" % (ref.arm[0] * 1e3, ref.arm[1] * 1e4, I_BAIL * 1e4))
    for stop in a.stops:
        print("stop hole %d deg:" % stop)
        for n in range(6, 0, -1):
            pc = NOTCH_PSIS[n - 1]
            r_rad = math.radians(pc)
            z_bot = ZP + (L_BALL + 1.30) * math.sin(r_rad) + 1.30 * math.cos(r_rad) - 21.335
            o = Linkage(pc, 90.0 - stop, cord=ref.cord, cam=a.cam).run()
            if o is None:
                print("   notch %d (arm %+5.1f, ball %.2f in): not reachable with this cord" % (n, pc, z_bot / 25.4))
                continue
            sl = "cord slack from bail %.0f deg" % o["slack"][0] if o["slack"] else "cord taut to the stop"
            print("   notch %d (arm %+5.1f, ball %.2f in): bails %5.1f deg, %.2f J, %s, bails at %2.0f deg, peak cord %3.0f N, v %.2f m/s, carry %.2f m%s" % (
                n, pc, z_bot / 25.4, o["th_cock"], o["work"], sl, o["th_end"], o["tension"], o["v"], carry(o["v"], stop, release_height(90 - stop)),
                "" if o["reached"] else "  (ARM DOES NOT REACH THE STOP)"))
    print("sensitivity, notch 6, 42 deg stop:")
    cases = [("spring E -20%", dict(e=1.70), 0.0), ("spring E +20%", dict(e=2.54), 0.0), ("rest/cocked 0.3", dict(ratio=0.3), 0.0),
             ("rest/cocked 0.7", dict(ratio=0.7), 0.0), ("cord 1 mm short", {}, -1.0), ("cord 1 mm long", {}, 1.0), ("cord 2 mm long", {}, 2.0)]
    for lab, kw, dl in cases:
        o = Linkage(cord=ref.cord + dl, cam=a.cam).run(**kw)
        print("   %-16s %s" % (lab, "notch 6 cannot be reached" if o is None else "bails %5.1f deg, v %.2f m/s, carry %.2f m%s" % (
            o["th_cock"], o["v"], carry(o["v"], 42, release_height(48)), "" if o["reached"] else "  (ARM DOES NOT REACH THE STOP)")))


if __name__ == "__main__":
    main()
