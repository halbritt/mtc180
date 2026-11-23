"""CalculiX 2.23 C3D8I Two-Phase FDM PETG FEA for MTC-180 v5 Floor-Flush Bail Coupler & Throwing Arm."""
import os, subprocess, sys, time
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

FEA_DIR = Path(__file__).resolve().parent
REPO_ROOT = FEA_DIR.parent
sys.path.insert(0, str(FEA_DIR))
sys.path.insert(0, str(REPO_ROOT / "analysis"))

from mesh_c3d8i import stl_to_c3d8i
from fea_model import E_PETG, NU_PETG, TRAP_PITCH, WIRE_HALF_CC, M_BALL_KG
from parse_frd import parse_frd, parse_dat_totals
from cam_launch_sim import HORN_R, HORN_A, Linkage, carry, release_height
import re
W_ARM = float(re.search(r"^W_ARM\s*=\s*([0-9.]+)", (REPO_ROOT / "cad/throwing_arm.star").read_text(), re.M).group(1))


def _write_set(f, kw, name, idx0):
    f.write(f"*{kw}, {kw}={name}\n")
    ids = [str(int(i) + 1) for i in idx0]
    for k in range(0, len(ids), 14):
        f.write(", ".join(ids[k : k + 14]) + "\n")


def _shell_split(nodes, hex8, ec, vols, exact_vol, wall_mm=1.80):
    fdefs = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    af = np.vstack([np.sort(hex8[:, fd], axis=1) for fd in fdefs])
    afc = np.vstack([nodes[hex8[:, fd]].mean(axis=1) for fd in fdefs])
    _, iu, cnt = np.unique(af, axis=0, return_index=True, return_counts=True)
    d, _ = cKDTree(afc[iu[cnt == 1]]).query(ec)
    sh = d <= wall_mm
    evol = vols * (exact_vol / vols.sum())
    dm = evol * np.where(sh, 1.27e-6, 0.15 * 1.27e-6)
    return sh, dm


def solve_coupler(stl_path: str, job_dir: str):
    os.makedirs(job_dir, exist_ok=True)
    nodes, hex8, ec, vols, exact_vol = stl_to_c3d8i(stl_path, pitch_xy=1.15, pitch_z=0.80)
    sh, dm = _shell_split(nodes, hex8, ec, vols, exact_vol)
    x, y, z = nodes[:, 0], nodes[:, 1], nodes[:, 2]
    bmask = np.zeros(len(nodes), dtype=bool)
    for yc in (-TRAP_PITCH, 0.0, TRAP_PITCH):
        for sgn in (-1.0, 1.0):
            bmask |= (x >= 28.5) & (x <= 42.5) & (np.abs(y - (yc + sgn * WIRE_HALF_CC)) <= 1.8) & (z >= 1.6) & (z <= 3.6)
    bidx = np.where(bmask)[0]
    eye = np.where((np.hypot(x - 50.8, y) <= 3.6) & (z >= 1.0) & (z <= 6.6))[0]
    inp = os.path.join(job_dir, "coupler.inp")
    with open(inp, "w") as f:
        f.write("*HEADING\nBail Coupler v5 (140 N Peak Cord Tension)\n*NODE, NSET=ALL\n")
        for i, (nx, ny, nz) in enumerate(nodes, 1):
            f.write(f"{i}, {nx:.4f}, {ny:.4f}, {nz:.4f}\n")
        f.write("*ELEMENT, TYPE=C3D8I, ELSET=EALL\n")
        for e, row in enumerate(hex8, 1):
            f.write(f"{e}, " + ", ".join(str(int(k) + 1) for k in row) + "\n")
        _write_set(f, "ELSET", "ESHELL", np.where(sh)[0])
        if (~sh).any():
            _write_set(f, "ELSET", "ECORE", np.where(~sh)[0])
        _write_set(f, "NSET", "BAIL", bidx)
        f.write(f"*MATERIAL, NAME=PS\n*ELASTIC\n{E_PETG}, {NU_PETG}\n*SOLID SECTION, ELSET=ESHELL, MATERIAL=PS\n")
        if (~sh).any():
            f.write("*MATERIAL, NAME=PG\n*ELASTIC\n160.0, 0.30\n*SOLID SECTION, ELSET=ECORE, MATERIAL=PG\n")
        # 85 N peak dynamic cord pull (linkage model: ~79 N near the stop) (-X/+Z breakaway + radial) reacted across the 6 driven-side wire seats
        f.write("*STEP\n*STATIC\n*BOUNDARY\nBAIL, 1, 3, 0.0\n*CLOAD\n")
        for nid in eye:
            f.write(f"{nid+1}, 1, {-58.0/len(eye):.5e}\n{nid+1}, 3, {-62.0/len(eye):.5e}\n")
        f.write("*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    env["OMP_NUM_THREADS"] = "8"
    subprocess.run(["ccx", "-i", "coupler"], cwd=job_dir, env=env, check=True, stdout=open(os.path.join(job_dir, "solve.log"), "w"), stderr=subprocess.STDOUT)
    st = parse_frd(os.path.join(job_dir, "coupler.frd"), len(nodes))[0]
    free = ~bmask & (np.hypot(x - 50.8, y) > 4.2)
    I_b = float(np.sum(dm * ((ec[:, 0] ** 2 + (ec[:, 2] - 2.95) ** 2) * 1e-6)))
    return len(hex8), exact_vol / 1e3, float(dm.sum() * 1e3), I_b, float(np.linalg.norm(st["U"], axis=1).max()), float(np.percentile(st["vm"][free], 99.8))


def solve_arm(stl_path: str, job_dir: str):
    os.makedirs(job_dir, exist_ok=True)
    nodes, hex8, ec, vols, exact_vol = stl_to_c3d8i(stl_path, pitch_xy=2.20, pitch_z=1.50)
    sh, dm = _shell_split(nodes, hex8, ec, vols, exact_vol)
    x, y, z = nodes[:, 0], nodes[:, 1], nodes[:, 2]
    piv = np.where(np.hypot(x, y) <= 3.8)[0]
    # Through-bolted M4 cord post on the horn tip (collar Z = 4.6..7.4 mm + clamped bore)
    tx, ty = HORN_R * np.cos(np.radians(HORN_A)), HORN_R * np.sin(np.radians(HORN_A))
    cam = np.where((np.hypot(x - tx, y - ty) <= 4.4) & (z >= 4.2) & (z <= 7.5))[0]
    # LC1: 85 N peak dynamic cord pull at +21 deg in arm frame (matching solve_coupler & camsim peak near stop)
    cdx_pk, cdy_pk = float(np.cos(np.radians(21.0))), float(np.sin(np.radians(21.0)))
    # LC3: 31 N static full-cock cord pull at -71 deg in arm frame (bails at 171 deg, arm at Notch 6 = -8.2 deg)
    cdx_ck, cdy_ck = float(np.cos(np.radians(-71.0))), float(np.sin(np.radians(-71.0)))
    cup = np.where((x <= -148.0) & (x >= -190.0) & (y <= -14.0) & (np.abs(z - W_ARM / 2.0) <= 5.0))[0]
    stop_pad = np.where((x >= -86.0) & (x <= -64.0) & (y >= 15.0) & (y <= 34.0))[0]
    tooth6 = np.where((np.hypot(x, y) >= 31.5) & (np.hypot(x, y) <= 37.5) & (x >= -6.2) & (x <= -1.2) & (y <= -30.0))[0]
    I_arm = float(np.sum(dm * ((ec[:, 0] ** 2 + ec[:, 1] ** 2) * 1e-6)))
    inp = os.path.join(job_dir, "arm.inp")
    with open(inp, "w") as f:
        f.write("*HEADING\nThrowing Arm v5 (Cord Horn Drive + CoP Stop + Ratchet Sear)\n*NODE, NSET=ALL\n")
        for i, (nx, ny, nz) in enumerate(nodes, 1):
            f.write(f"{i}, {nx:.4f}, {ny:.4f}, {nz:.4f}\n")
        f.write("*ELEMENT, TYPE=C3D8I, ELSET=EALL\n")
        for e, row in enumerate(hex8, 1):
            f.write(f"{e}, " + ", ".join(str(int(k) + 1) for k in row) + "\n")
        _write_set(f, "ELSET", "ESHELL", np.where(sh)[0])
        if (~sh).any():
            _write_set(f, "ELSET", "ECORE", np.where(~sh)[0])
        for nm, st in [("PIV", piv), ("STOPP", stop_pad), ("TOOTH", tooth6)]:
            _write_set(f, "NSET", nm, st)
        f.write(f"*MATERIAL, NAME=PS\n*ELASTIC\n{E_PETG}, {NU_PETG}\n*SOLID SECTION, ELSET=ESHELL, MATERIAL=PS\n")
        if (~sh).any():
            f.write("*MATERIAL, NAME=PG\n*ELASTIC\n160.0, 0.30\n*SOLID SECTION, ELSET=ECORE, MATERIAL=PG\n")
        # Step 1: Peak Dynamic Cord Pull (85 N on through-bolted collar at +21 deg, matching coupler FEA)
        f.write(f"*STEP\n*STATIC\n*BOUNDARY\nPIV, 1, 3, 0.0\n{cup[0]+1}, 2, 2, 0.0\n*CLOAD\n")
        for nid in cam:
            f.write(f"{nid+1}, 1, {85.0*cdx_pk/len(cam):.5e}\n{nid+1}, 2, {85.0*cdy_pk/len(cam):.5e}\n")
        for nid in cup:
            f.write(f"{nid+1}, 2, {-16.0/len(cup):.5e}\n{nid+1}, 1, {-12.0/len(cup):.5e}\n")
        f.write("*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
        # Step 2: CoP Stop Sleeve Impact (D'Alembert angular deceleration alpha=10000 rad/s^2 reacted by PIV + STOPP)
        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nPIV, 1, 3, 0.0\nSTOPP, 2, 2, 0.0\n*CLOAD, OP=NEW\n")
        fx, fy = np.zeros(len(nodes)), np.zeros(len(nodes))
        # Clockwise stop inertia: (-y_m, +x_m) -> at cup (-170, 0) pushes UP (+y) into STOPP!
        dfx = (dm / 8.0) * (ec[:, 1] * 1e-3) * 10000.0
        dfy = -(dm / 8.0) * (ec[:, 0] * 1e-3) * 10000.0
        for c in range(8):
            np.add.at(fx, hex8[:, c], dfx)
            np.add.at(fy, hex8[:, c], dfy)
        for nid in np.where((np.abs(fx) > 1e-7) | (np.abs(fy) > 1e-7))[0]:
            f.write(f"{nid+1}, 1, {fx[nid]:.5e}\n{nid+1}, 2, {fy[nid]:.5e}\n")
        f.write("*NODE PRINT, NSET=STOPP, TOTALS=ONLY\nRF\n*NODE PRINT, NSET=PIV, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
        # Step 3: Full-Cock Ratchet Tooth #6 Holding the 31 N static cord pull (bails at 171 deg)
        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nPIV, 1, 3, 0.0\nTOOTH, 1, 1, 0.0\n*CLOAD, OP=NEW\n")
        for nid in cam:
            f.write(f"{nid+1}, 1, {31.0*cdx_ck/len(cam):.5e}\n{nid+1}, 2, {31.0*cdy_ck/len(cam):.5e}\n")
        f.write("*NODE PRINT, NSET=TOOTH, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    env["OMP_NUM_THREADS"] = "8"
    subprocess.run(["ccx", "-i", "arm"], cwd=job_dir, env=env, check=True, stdout=open(os.path.join(job_dir, "solve.log"), "w"), stderr=subprocess.STDOUT)
    steps = parse_frd(os.path.join(job_dir, "arm.frd"), len(nodes))
    tots = parse_dat_totals(os.path.join(job_dir, "arm.dat"))
    free = (np.hypot(x, y) > 6.0) & ~((x >= -88.0) & (x <= -62.0) & (y >= 14.0)) & (y > -32.0)
    return len(hex8), exact_vol / 1e3, float(dm.sum() * 1e3), I_arm, steps, tots, free, fx, fy


def main():
    t0 = time.time()
    c_stl = REPO_ROOT / "exports" / "mtc180_bail_coupler.stl"
    a_stl = REPO_ROOT / "exports" / "mtc180_throwing_arm.stl"
    nc, vc, mc, Ib, uc, vmc = solve_coupler(str(c_stl), str(FEA_DIR / "jobs" / "v5_coupler"))
    na, va, ma, Ia, steps, tots, free, fx, fy = solve_arm(str(a_stl), str(FEA_DIR / "jobs" / "v5_arm"))
    # Launch speed from the cord-linkage model with this arm's sliced mass and inertia (+4.0 g through-bolted M4 x 16 + washer + nut)
    cg = (-22.0, 6.0)
    arm = (ma * 1e-3 + 0.0040, Ia + 0.0040 * (HORN_R * 1e-3) ** 2, cg)
    sim = Linkage(arm=arm).run()
    v0 = sim["v"]
    ke_stop = 0.5 * (Ia + 0.0040 * (HORN_R * 1e-3) ** 2) * (v0 / 0.1713) ** 2
    u2 = steps[1]["U"]
    u_el = 0.5 * float(np.sum(fx * u2[:, 0] + fy * u2[:, 1])) * 1e-3
    f_stop = next((float(np.hypot(rx, ry)) for sn, rx, ry, _ in tots if sn == "STOPP"), 0.0)
    f_piv = next((float(np.hypot(rx, ry)) for sn, rx, ry, _ in tots if sn == "PIV"), 0.0)
    lam = float(np.sqrt(ke_stop / max(1e-9, u_el + 0.5 * (f_stop ** 2) / 380000.0)))
    f_sear = next((abs(rx) for sn, rx, _, _ in tots if sn == "TOOTH"), 0.0)
    print(f"Solved {nc} coupler + {na} arm C3D8I elements in {time.time()-t0:.1f}s")
    print(f"  Coupler: Vol={vc:.2f} cm^3 | Mass={mc:.1f} g | I_coupler={Ib*1e4:.3f} kg*cm^2 | 85N Cord U_max={uc:.2f} mm, VM_p99.8={vmc:.2f} MPa")
    print(f"  Arm    : Vol={va:.2f} cm^3 | Mass={ma:.1f} g | I_arm={Ia*1e4:.3f} kg*cm^2 | v0={v0:.2f} m/s (carry {carry(v0, 42, release_height(48)):.2f} m @ 42 deg, peak cord {sim['tension']:.0f} N)")
    print(f"  Arm LC1 (Launch Drive): VM_p99.8={float(np.percentile(steps[0]['vm'][free], 99.8)):.2f} MPa")
    print(f"  Arm LC2 (CoP Stop Sleeve): VM_p99.8={float(np.percentile((steps[1]['vm']*lam)[free], 99.8)):.2f} MPa | Stop={f_stop*lam:.0f} N vs Pivot={f_piv*lam:.0f} N")
    print(f"  Arm LC3 (Ratchet Tooth #6 Standby): VM_p99.8={float(np.percentile(steps[2]['vm'][free], 99.8)):.2f} MPa | Tooth Reaction={f_sear:.1f} N")


if __name__ == "__main__":
    main()
