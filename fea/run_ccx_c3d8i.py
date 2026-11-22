"""Run 4-step Two-Phase FDM PETG CalculiX 2.23 C3D8I FEA for Carrier v4 (Driven V-Seats + CoP Stop + D-Loop Sear)."""
import os
import subprocess
import numpy as np
from scipy.spatial import cKDTree
from mesh_c3d8i import stl_to_c3d8i
from fea_model import E_PETG, NU_PETG, TRAP_PITCH, WIRE_HALF_CC, M_BALL_KG, R_BALL_MM, E_SPRING_EFF_J
from parse_frd import parse_frd, parse_dat_totals


def write_set(f, kw, name, idx0):
    f.write(f"*{kw}, {kw}={name}\n")
    ids = [str(int(i) + 1) for i in idx0]
    for k in range(0, len(ids), 14):
        f.write(", ".join(ids[k : k + 14]) + "\n")


def run_carrier_fdm_c3d8i(stl_path: str, job_dir: str, label: str, pitch_xy: float = 1.75, pitch_z: float = 1.00, wall_mm: float = 1.80):
    os.makedirs(job_dir, exist_ok=True)
    nodes, hex8, ec, vols, exact_vol_mm3 = stl_to_c3d8i(stl_path, pitch_xy=pitch_xy, pitch_z=pitch_z)
    elem_vols = vols * (exact_vol_mm3 / vols.sum())

    face_defs = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    all_faces = np.vstack([np.sort(hex8[:, fd], axis=1) for fd in face_defs])
    all_fc = np.vstack([nodes[hex8[:, fd]].mean(axis=1) for fd in face_defs])
    _, idx_u, counts = np.unique(all_faces, axis=0, return_index=True, return_counts=True)
    dist_surf, _ = cKDTree(all_fc[idx_u[counts == 1]]).query(ec)
    is_shell = dist_surf <= wall_mm
    shell_el, core_el = np.where(is_shell)[0], np.where(~is_shell)[0]

    dm_kg = elem_vols * np.where(is_shell, 1.27e-6, 0.15 * 1.27e-6)
    mass_g = float(dm_kg.sum() * 1e3)
    r2_m2 = (ec[:, 0] ** 2 + (ec[:, 2] - 3.05) ** 2) * 1e-6
    I_arm = float(np.sum(dm_kg * r2_m2))
    I_ball = M_BALL_KG * (R_BALL_MM * 1e-3) ** 2
    omega0 = float(np.sqrt(2.0 * E_SPRING_EFF_J / (I_arm + I_ball)))
    v0_ms = omega0 * (R_BALL_MM * 1e-3)
    alpha_ref = 10000.0

    x, y, z = nodes[:, 0], nodes[:, 1], nodes[:, 2]
    bail_mask = np.zeros(len(nodes), dtype=bool)
    for yc in (-TRAP_PITCH, 0.0, TRAP_PITCH):
        for sgn in (-1.0, 1.0):
            yw = yc + sgn * WIRE_HALF_CC
            bail_mask |= (x >= 20.0) & (x <= 46.5) & (np.abs(y - yw) <= 2.3) & (z >= 2.0) & (z <= 5.2)
    bail_idx = np.where(bail_mask)[0]
    # True 1-row pin line at rear of bail seat (prevents artificial moment clamping across a 6.5 mm X band!)
    x_pin = float(x[bail_idx].min())
    hinge_idx = bail_idx[x[bail_idx] <= x_pin + pitch_xy * 0.65]
    xbar_idx = np.where((x >= 41.5) & (x <= 46.5) & (z >= 3.0) & (z <= 5.5) & (np.abs(y) <= 66.0))[0]

    seat_r = np.hypot(x - R_BALL_MM, y)
    seat_idx = np.where((seat_r >= 10.5) & (seat_r <= 22.5) & (z >= 2.5) & (z <= 19.0))[0]
    backstop_idx = np.where((x >= R_BALL_MM + 15.0) & (seat_r <= 25.0) & (np.abs(y) <= 13.5) & (z >= 15.0) & (z <= 27.5))[0]
    stoppad_idx = np.where((x >= 96.0) & (x <= 108.0) & (np.abs(y) <= 33.5) & (z >= 13.2))[0]
    dloop_idx = np.where((x >= R_BALL_MM + 35.0) & (np.abs(y) <= 14.0) & (z >= 3.2))[0]
    pet_pos = np.where((np.abs(x - R_BALL_MM) <= 3.5) & (y > 19.5) & (seat_r <= 22.4) & (z >= 28.2) & (z <= 29.8))[0]
    pet_neg = np.where((np.abs(x - R_BALL_MM) <= 3.5) & (y < -19.5) & (seat_r <= 22.4) & (z >= 28.2) & (z <= 29.8))[0]

    # +Z leads the swing: at CoP stop impact, carrier D'Alembert inertia pushes in +Z into STOPPAD (Z = 14.6)!
    fx_ref, fz_ref = np.zeros(len(nodes)), np.zeros(len(nodes))
    xm_e = np.maximum(0.0, ec[:, 0]) * 1e-3
    dfx_e = (dm_kg / 8.0) * xm_e * (omega0 ** 2)
    dfz_e = +(dm_kg / 8.0) * xm_e * alpha_ref
    for c in range(8):
        np.add.at(fx_ref, hex8[:, c], dfx_e)
        np.add.at(fz_ref, hex8[:, c], dfz_e)

    inp = os.path.join(job_dir, "carrier.inp")
    with open(inp, "w") as f:
        f.write(f"*HEADING\n{label}\n*NODE, NSET=ALL\n")
        for i, (nx, ny, nz) in enumerate(nodes, start=1):
            f.write(f"{i}, {nx:.4f}, {ny:.4f}, {nz:.4f}\n")
        f.write("*ELEMENT, TYPE=C3D8I, ELSET=EALL\n")
        for e, row in enumerate(hex8, start=1):
            f.write(f"{e}, " + ", ".join(str(int(k) + 1) for k in row) + "\n")
        write_set(f, "ELSET", "ESHELL", shell_el)
        if len(core_el) > 0:
            write_set(f, "ELSET", "ECORE", core_el)
        for nm, st in [("BAIL", bail_idx), ("HINGE", hinge_idx), ("STOPPAD", stoppad_idx), ("DLOOP", dloop_idx), ("PETPOS", pet_pos), ("PETNEG", pet_neg)]:
            write_set(f, "NSET", nm, st)

        f.write(f"*MATERIAL, NAME=PETG_SHELL\n*ELASTIC\n{E_PETG}, {NU_PETG}\n*SOLID SECTION, ELSET=ESHELL, MATERIAL=PETG_SHELL\n")
        if len(core_el) > 0:
            f.write("*MATERIAL, NAME=PETG_GYROID15\n*ELASTIC\n160.0, 0.30\n*SOLID SECTION, ELSET=ECORE, MATERIAL=PETG_GYROID15\n")

        # Step 1: 25 N axial launch ball load (-Z) + 20 N centrifugal ball load (+X on v4 backstop)
        f.write("*STEP\n*STATIC\n*BOUNDARY\nBAIL, 1, 3, 0.0\n*CLOAD\n")
        for nid in seat_idx:
            f.write(f"{nid+1}, 3, {-25.0/len(seat_idx):.5e}\n")
        for nid in backstop_idx:
            f.write(f"{nid+1}, 1, {20.0/len(backstop_idx):.5e}\n")
        f.write("*NODE PRINT, NSET=BAIL, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

        # Step 2: CoP Stop-Block Deceleration at X = 96..108 mm (Z = 14.6) + True Rear Pin Line
        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nHINGE, 1, 3, 0.0\nSTOPPAD, 3, 3, 0.0\n*CLOAD, OP=NEW\n")
        for nid in np.where((np.abs(fx_ref) > 1e-7) | (np.abs(fz_ref) > 1e-7))[0]:
            if abs(fx_ref[nid]) > 1e-7:
                f.write(f"{nid+1}, 1, {fx_ref[nid]:.5e}\n")
            if abs(fz_ref[nid]) > 1e-7:
                f.write(f"{nid+1}, 3, {fz_ref[nid]:.5e}\n")
        f.write("*NODE PRINT, NSET=STOPPAD, TOTALS=ONLY\nRF\n*NODE PRINT, NSET=HINGE, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

        # Step 3: Cocked Standby — Distal D-Loop Sear (X = 175.5..180.5) Holding 3 Mousetrap Crossbars (X = 44.1, F_eq = 82.8 N -> 1.95 N*m about pin!)
        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nDLOOP, 3, 3, 0.0\nHINGE, 1, 3, 0.0\n*CLOAD, OP=NEW\n")
        f_xbar = (1950.0 / (44.1 - x_pin)) / len(xbar_idx)
        for nid in xbar_idx:
            f.write(f"{nid+1}, 3, {f_xbar:.5e}\n")
        f.write("*NODE PRINT, NSET=DLOOP, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

    env = dict(os.environ, OMP_NUM_THREADS="8")
    env.pop("DISPLAY", None)
    subprocess.run(["ccx", "-i", "carrier"], cwd=job_dir, env=env, check=True, stdout=open(os.path.join(job_dir, "solve.log"), "w"), stderr=subprocess.STDOUT)
    steps = parse_frd(os.path.join(job_dir, "carrier.frd"), len(nodes))
    tots = parse_dat_totals(os.path.join(job_dir, "carrier.dat"))
    dyn = {
        "vol_cm3": exact_vol_mm3 / 1000.0, "mass_g": mass_g, "shell_pct": float(is_shell.mean() * 100.0),
        "I_arm_kgm2": I_arm, "omega0_rads": omega0, "v0_ms": v0_ms, "alpha_ref": alpha_ref,
        "elem_c": ec, "dm_kg": dm_kg, "vols": elem_vols, "fx_ref": fx_ref, "fz_ref": fz_ref, "is_shell": is_shell,
    }
    return nodes, hex8, dyn, steps, tots


def run_cup_petal_c3d8i(stl_path: str, job_dir: str, pitch: float = 0.95):
    """Fine-pitch (0.95 mm) cup subregion C3D8I solve so the 2.4 mm outboard backstop slits never bridge across voxel corners."""
    os.makedirs(job_dir, exist_ok=True)
    nodes, hex8, ec, _, _ = stl_to_c3d8i(stl_path, pitch_xy=pitch, pitch_z=pitch, x_min=114.0)
    x, y, z = nodes[:, 0], nodes[:, 1], nodes[:, 2]
    neck_idx = np.where(x <= 116.0)[0]
    cand_pos = np.where((np.abs(x - R_BALL_MM) <= 1.6) & (y > 19.5) & (z >= 28.5) & (z <= 29.5))[0]
    cand_neg = np.where((np.abs(x - R_BALL_MM) <= 1.6) & (y < -19.5) & (z >= 28.5) & (z <= 29.5))[0]
    # Touch only the inner-most throat contact line so petal wall cross-sections remain free to rotate in bending
    pet_pos = cand_pos[y[cand_pos] <= float(y[cand_pos].min()) + 0.45 * pitch]
    pet_neg = cand_neg[y[cand_neg] >= float(y[cand_neg].max()) - 0.45 * pitch]

    inp = os.path.join(job_dir, "cup_petal.inp")
    with open(inp, "w") as f:
        f.write("*HEADING\nFine-mesh Cup Compliant Petal Snap (0.70 mm C3D8I)\n*NODE, NSET=ALL\n")
        for i, (nx, ny, nz) in enumerate(nodes, start=1):
            f.write(f"{i}, {nx:.4f}, {ny:.4f}, {nz:.4f}\n")
        f.write("*ELEMENT, TYPE=C3D8I, ELSET=EALL\n")
        for e, row in enumerate(hex8, start=1):
            f.write(f"{e}, " + ", ".join(str(int(k) + 1) for k in row) + "\n")
        for nm, st in [("NECK", neck_idx), ("PETPOS", pet_pos), ("PETNEG", pet_neg)]:
            write_set(f, "NSET", nm, st)
        f.write(f"*MATERIAL, NAME=PETG_SHELL\n*ELASTIC\n{E_PETG}, {NU_PETG}\n*SOLID SECTION, ELSET=EALL, MATERIAL=PETG_SHELL\n")
        f.write("*STEP\n*STATIC\n*BOUNDARY\nNECK, 1, 3, 0.0\nPETPOS, 2, 2, 0.385\nPETNEG, 2, 2, -0.385\n")
        f.write("*NODE PRINT, NSET=PETPOS, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

    env = dict(os.environ, OMP_NUM_THREADS="8")
    env.pop("DISPLAY", None)
    subprocess.run(["ccx", "-i", "cup_petal"], cwd=job_dir, env=env, check=True, stdout=open(os.path.join(job_dir, "solve.log"), "w"), stderr=subprocess.STDOUT)
    steps = parse_frd(os.path.join(job_dir, "cup_petal.frd"), len(nodes))
    tots = parse_dat_totals(os.path.join(job_dir, "cup_petal.dat"))
    free_petal = (z >= 18.0) & (z <= 27.8)
    vm_pet = float(np.percentile(steps[0]["vm"][free_petal], 99.8))
    f_pet = next((abs(fy) for sname, _, fy, _ in tots if sname == "PETPOS"), 0.0)
    return len(hex8), f_pet, vm_pet
