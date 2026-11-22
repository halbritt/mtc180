"""Run 4-step Two-Phase FDM PETG CalculiX 2.23 C3D8I FEA on exports/mtc180_positivelock_petg.stl (v4 Load Path)."""
from pathlib import Path
import sys
import time
import numpy as np

FEA_DIR = Path(__file__).resolve().parent
REPO_ROOT = FEA_DIR.parent
sys.path.insert(0, str(FEA_DIR))

from run_ccx_c3d8i import run_carrier_fdm_c3d8i, run_cup_petal_c3d8i
from fea_model import E_SPRING_EFF_J, M_BALL_KG, R_BALL_MM


def main():
    stl_path = REPO_ROOT / "exports" / "mtc180_positivelock_petg.stl"
    if not stl_path.exists():
        raise SystemExit(f"Missing {stl_path}; run `mise run export` first.")
    job_dir = FEA_DIR / "jobs" / "positivelock_v4_fdm"
    cup_job_dir = FEA_DIR / "jobs" / "positivelock_v4_cup_petal"

    t0 = time.time()
    nodes, hex8, dyn, steps, tots = run_carrier_fdm_c3d8i(
        str(stl_path),
        str(job_dir),
        "MTC-180L-PL v4.1 (Driven V-Seats + CoP Stop Block @ X=102mm + D-Loop Sear, FDM Shell + 15% Gyroid)",
        pitch_xy=1.55,
        pitch_z=1.00,
    )
    n_cup_el, f_petal, vm_petal = run_cup_petal_c3d8i(str(stl_path), str(cup_job_dir), pitch=0.95)
    elapsed = time.time() - t0

    I_arm = dyn["I_arm_kgm2"]
    I_ball = M_BALL_KG * (R_BALL_MM * 1e-3) ** 2
    ke_arm_j = E_SPRING_EFF_J * (I_arm / (I_arm + I_ball))
    x, y, z = nodes[:, 0], nodes[:, 1], nodes[:, 2]
    free_arm = ~((x <= 47.5) & (z <= 5.5)) & ~((x >= 95.0) & (x <= 109.0) & (z >= 12.8)) & ~(x >= 174.5)

    u_s1 = float(np.linalg.norm(steps[0]["U"], axis=1).max())
    vm_s1 = float(np.percentile(steps[0]["vm"][free_arm], 99.8))

    # Scale Step 2 (CoP stop impact on 3 mm rubber pad, k_pad ≈ 430 N/mm at X = 102 mm) to absorb ke_arm_j
    u2 = steps[1]["U"]
    u_car_j = 0.5 * float(np.sum(dyn["fx_ref"] * u2[:, 0] + dyn["fz_ref"] * u2[:, 2])) * 1e-3
    f_stop_ref = next((abs(fz) for sname, _, _, fz in tots if sname == "STOPPAD"), 0.0)
    f_hinge_ref = next((abs(fz) for sname, _, _, fz in tots if sname == "HINGE"), 0.0)
    u_pad_j = 0.5 * (f_stop_ref ** 2) / 430000.0  # 430 N/mm = 4.3e5 N/m rubber pad stiffness
    lam = float(np.sqrt(ke_arm_j / max(1e-9, u_car_j + u_pad_j)))
    vm_s2 = float(np.percentile((steps[1]["vm"] * lam)[free_arm], 99.8))
    szz_s2 = float(np.percentile((steps[1]["S"][:, 2] * lam)[free_arm], 99.8))

    vm_s3 = float(np.percentile(steps[2]["vm"][free_arm], 99.8))
    f_dloop = next((abs(fz) for sname, _, _, fz in tots if sname == "DLOOP"), 0.0)

    print(f"Solved {len(hex8)} carrier + {n_cup_el} fine-cup C3D8I elements ({dyn['shell_pct']:.1f}% shell) in {elapsed:.1f}s")
    print(f"  CAD Vol = {dyn['vol_cm3']:.2f} cm^3 | Two-Phase FDM Mass = {dyn['mass_g']:.1f} g | I_arm = {I_arm*1e4:.3f} kg*cm^2 | v0 = {dyn['v0_ms']:.2f} m/s")
    print(f"  LC1 (25 N Axial + 20 N Radial Backstop): U_max = {u_s1:.2f} mm | VM_p99.8 = {vm_s1:.2f} MPa")
    print(f"  LC2 (CoP Padded Stop @ X=102mm): VM_p99.8 = {vm_s2:.2f} MPa | S_zz = {szz_s2:.2f} MPa | Pad={f_stop_ref*lam:.0f} N vs Hinge={f_hinge_ref*lam:.0f} N")
    print(f"  LC3 (180-deg D-Loop Sear Standby): VM_p99.8 = {vm_s3:.2f} MPa | Sear Load = {f_dloop:.1f} N")
    print(f"  LC4 (0.385 mm Compliant Petal Snap, 0.95mm mesh): Normal = {f_petal:.2f} N/petal | VM_p99.8 = {vm_petal:.2f} MPa")


if __name__ == "__main__":
    main()
