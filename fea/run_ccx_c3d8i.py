"""Run 4-step Two-Phase FDM PETG (Solid Shell + 15% Gyroid Core) CalculiX 2.23 C3D8I FEA study."""
import os, subprocess
import numpy as np
import trimesh
from mesh_c3d8i import stl_to_c3d8i
from fea_model import E_PETG, NU_PETG, TRAP_PITCH, WIRE_HALF_CC, M_BALL_KG, R_BALL_MM, E_SPRING_EFF_J
from parse_frd import parse_frd, parse_dat_totals


def write_set(f, kw, name, idx0):
    f.write(f"*{kw}, {kw}={name}\n")
    ids = [str(int(i) + 1) for i in idx0]
    for k in range(0, len(ids), 14):
        f.write(", ".join(ids[k : k + 14]) + "\n")


def run_carrier_fdm_c3d8i(stl_path: str, job_dir: str, label: str, pitch_xy: float = 1.70, pitch_z: float = 1.00, wall_mm: float = 1.80):
    os.makedirs(job_dir, exist_ok=True)
    nodes, hex8, ec, vols, exact_vol_mm3 = stl_to_c3d8i(stl_path, pitch_xy=pitch_xy, pitch_z=pitch_z)
    vol_scale = exact_vol_mm3 / vols.sum()
    elem_vols = vols * vol_scale

    # Exact distance from each brick centroid to exterior surface faces via scipy cKDTree (8 ms!)
    from scipy.spatial import cKDTree
    face_defs = [(0,1,2,3), (4,5,6,7), (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7)]
    all_faces = np.vstack([np.sort(hex8[:, fd], axis=1) for fd in face_defs])
    all_fc = np.vstack([nodes[hex8[:, fd]].mean(axis=1) for fd in face_defs])
    _, idx_u, counts = np.unique(all_faces, axis=0, return_index=True, return_counts=True)
    ext_fc = all_fc[idx_u[counts == 1]]
    dist_surf, _ = cKDTree(ext_fc).query(ec)
    is_shell = dist_surf <= wall_mm
    shell_el = np.where(is_shell)[0]
    core_el = np.where(~is_shell)[0]

    # Exact FDM element mass: 1.27 g/cm^3 in solid perimeters/shells, 15% * 1.27 = 0.1905 g/cm^3 in gyroid core
    rho_e_kg_mm3 = np.where(is_shell, 1.27e-6, 0.15 * 1.27e-6)
    dm_kg = elem_vols * rho_e_kg_mm3
    mass_g = float(dm_kg.sum() * 1e3)
    r2_m2 = (ec[:, 0] ** 2 + (ec[:, 2] - 3.15) ** 2) * 1e-6
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
            bail_mask |= (x >= 21.0) & (x <= 46.5) & (np.abs(y - yw) <= 2.3) & (z >= 0.8) & (z <= 4.4)
    bail_idx = np.where(bail_mask)[0]

    seat_r = np.hypot(x - 140.0, y)
    seat_idx = np.where((seat_r >= 10.5) & (seat_r <= 22.5) & (z >= 2.5) & (z <= 19.0))[0]
    latch_cand = np.where((x >= 51.0) & (x <= 59.0) & (np.abs(y) <= 12.0))[0]
    z_top = float(z[latch_cand].max())
    latch_idx = latch_cand[z[latch_cand] >= z_top - 1.8]
    hinge_idx = bail_idx[x[bail_idx] <= 26.5]
    pet_pos = np.where((np.abs(x - 140.0) <= 9.0) & (y > 17.5) & (z >= 27.0) & (z <= 31.2))[0]
    pet_neg = np.where((np.abs(x - 140.0) <= 9.0) & (y < -17.5) & (z >= 27.0) & (z <= 31.2))[0]

    fx_ref = np.zeros(len(nodes))
    fz_ref = np.zeros(len(nodes))
    xm_e = np.maximum(0.0, ec[:, 0]) * 1e-3
    dfx_e = (dm_kg / 8.0) * xm_e * (omega0 ** 2)
    dfz_e = -(dm_kg / 8.0) * xm_e * alpha_ref
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
        write_set(f, "NSET", "BAIL", bail_idx)
        write_set(f, "NSET", "LATCH", latch_idx)
        write_set(f, "NSET", "HINGE", hinge_idx)
        write_set(f, "NSET", "PETPOS", pet_pos)
        write_set(f, "NSET", "PETNEG", pet_neg)

        f.write(f"*MATERIAL, NAME=PETG_SHELL\n*ELASTIC\n{E_PETG}, {NU_PETG}\n*SOLID SECTION, ELSET=ESHELL, MATERIAL=PETG_SHELL\n")
        if len(core_el) > 0:
            f.write(f"*MATERIAL, NAME=PETG_GYROID15\n*ELASTIC\n160.0, 0.30\n*SOLID SECTION, ELSET=ECORE, MATERIAL=PETG_GYROID15\n")

        f.write("*STEP\n*STATIC\n*BOUNDARY\nBAIL, 1, 3, 0.0\n*CLOAD\n")
        fs = -25.0 / len(seat_idx)
        for nid in seat_idx: f.write(f"{nid+1}, 3, {fs:.5e}\n")
        f.write("*NODE PRINT, NSET=BAIL, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nBAIL, 1, 3, 0.0\n*CLOAD, OP=NEW\n")
        for nid in np.where((np.abs(fx_ref) > 1e-7) | (np.abs(fz_ref) > 1e-7))[0]:
            if abs(fx_ref[nid]) > 1e-7: f.write(f"{nid+1}, 1, {fx_ref[nid]:.5e}\n")
            if abs(fz_ref[nid]) > 1e-7: f.write(f"{nid+1}, 3, {fz_ref[nid]:.5e}\n")
        f.write("*NODE PRINT, NSET=BAIL, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nLATCH, 1, 3, 0.0\nHINGE, 3, 3, 0.0\n*CLOAD, OP=NEW\n")
        fb = 48.0 / len(bail_idx)
        for nid in bail_idx: f.write(f"{nid+1}, 3, {fb:.5e}\n")
        f.write("*NODE PRINT, NSET=LATCH, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

        f.write("*STEP\n*STATIC\n*BOUNDARY, OP=NEW\nBAIL, 1, 3, 0.0\nPETPOS, 2, 2, 0.42\nPETNEG, 2, 2, -0.42\n*CLOAD, OP=NEW\n")
        f.write("*NODE PRINT, NSET=PETPOS, TOTALS=ONLY\nRF\n*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")

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
