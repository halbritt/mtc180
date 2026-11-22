"""Run 4-step Two-Phase FDM PETG CalculiX 2.23 C3D8I FEA on exports/mtc180_positivelock_petg.stl."""
from pathlib import Path
import sys
import time
import numpy as np

FEA_DIR = Path(__file__).resolve().parent
REPO_ROOT = FEA_DIR.parent
sys.path.insert(0, str(FEA_DIR))

from run_ccx_c3d8i import run_carrier_fdm_c3d8i
from fea_model import E_SPRING_EFF_J, M_BALL_KG, R_BALL_MM


def main():
    stl_path = REPO_ROOT / "exports" / "mtc180_positivelock_petg.stl"
    if not stl_path.exists():
        raise SystemExit(f"Missing {stl_path}; run `mise run export` first.")
    job_dir = FEA_DIR / "jobs" / "positivelock_fdm"

    t0 = time.time()
    nodes, hex8, dyn, steps, tots = run_carrier_fdm_c3d8i(
        str(stl_path),
        str(job_dir),
        "MTC-180L-PL (Caliper-Exact 38.70mm C-to-C, FDM Shell + 15% Gyroid)",
        pitch_xy=1.80,
        pitch_z=1.05,
    )
    elapsed = time.time() - t0

    I_arm = dyn["I_arm_kgm2"]
    I_ball = M_BALL_KG * (R_BALL_MM * 1e-3) ** 2
    ke_arm_j = E_SPRING_EFF_J * (I_arm / (I_arm + I_ball))
    free_arm = ~((nodes[:, 0] <= 47.5) & (nodes[:, 2] <= 4.8))

    u_s1 = float(np.linalg.norm(steps[0]["U"], axis=1).max())
    vm_s1 = float(np.percentile(steps[0]["vm"][free_arm], 99.8))

    u2 = steps[1]["U"]
    u_car_j = 0.5 * float(np.sum(dyn["fx_ref"] * u2[:, 0] + dyn["fz_ref"] * u2[:, 2])) * 1e-3
    xm_e = np.maximum(0.0, dyn["elem_c"][:, 0]) * 1e-3
    m_root_nm = float(np.sum((dyn["dm_kg"] * xm_e) * (xm_e * dyn["alpha_ref"])))
    u_mnt_j = 0.5 * (m_root_nm ** 2) / 270.0
    lam = float(np.sqrt(ke_arm_j / max(1e-9, u_car_j + u_mnt_j)))
    vm_s2 = float(np.percentile((steps[1]["vm"] * lam)[free_arm], 99.8))
    szz_s2 = float(np.percentile((steps[1]["S"][:, 2] * lam)[free_arm], 99.8))

    print(f"Solved {len(hex8)} C3D8I elements ({dyn['shell_pct']:.1f}% shell) in {elapsed:.1f}s")
    print(f"  CAD Vol = {dyn['vol_cm3']:.2f} cm^3 | Two-Phase FDM Mass = {dyn['mass_g']:.1f} g | v0 = {dyn['v0_ms']:.2f} m/s")
    print(f"  LC1 (25 N Launch Seat): U_max = {u_s1:.2f} mm | VM_p99.8 = {vm_s1:.2f} MPa")
    print(f"  LC2 (0-deg Stop Shock): VM_p99.8 = {vm_s2:.2f} MPa | Interlayer S_zz = {szz_s2:.2f} MPa")


if __name__ == "__main__":
    main()
