"""Headless CalculiX CGX (.frd -> .png) Von Mises contour exporter using proximal verified syntax."""
import os
import subprocess


def render_cgx_vm(job_dir: str, out_png: str, step_ds: int = 4, entity: int = 7):
    fbl = os.path.join(job_dir, "render_vm.fbl")
    with open(fbl, "w") as f:
        f.write(
            f"read carrier.frd\n"
            f"rot u 35\n"
            f"rot r 25\n"
            f"ds {step_ds} e {entity}\n"
            f"plot fv all\n"
            f"frame\n"
            f"zoom 0.82\n"
            f"hcpy png cgx_vm\n"
            f"quit\n"
        )
    env = dict(os.environ)
    env.pop("DISPLAY", None)
    subprocess.run(
        ["timeout", "20", "xvfb-run", "-a", "cgx", "-b", "render_vm.fbl"],
        cwd=job_dir,
        env=env,
        check=True,
        stdout=open(os.path.join(job_dir, "cgx.log"), "w"),
        stderr=subprocess.STDOUT,
    )
    for fn in sorted(os.listdir(job_dir)):
        if fn.startswith("cgx_vm") and fn.endswith(".png"):
            os.replace(os.path.join(job_dir, fn), out_png)
            return out_png
    raise RuntimeError(f"CGX did not write cgx_vm*.png in {job_dir}; check cgx.log")
