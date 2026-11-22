"""Parse CalculiX ASCII .frd (nodal U and extrapolated S) and .dat reaction forces."""
import re
import numpy as np


def parse_frd(frd_path: str, n_nodes: int):
    """Return list of dicts per step: {'U': (N,3), 'S': (N,6) [Sxx,Syy,Szz,Sxy,Syz,Sxz], 'vm': (N,)}."""
    steps_u = []
    steps_s = []
    with open(frd_path, "r", errors="replace") as f:
        lines = f.readlines()

    i = 0
    n_lines = len(lines)
    while i < n_lines:
        line = lines[i]
        if line.startswith(" -4  DISP"):
            arr = np.zeros((n_nodes, 3), dtype=np.float64)
            i += 1
            while i < n_lines and not lines[i].startswith(" -3"):
                s = lines[i]
                if s.startswith(" -1"):
                    nid = int(s[3:13]) - 1
                    arr[nid, 0] = float(s[13:25])
                    arr[nid, 1] = float(s[25:37])
                    arr[nid, 2] = float(s[37:49])
                i += 1
            steps_u.append(arr)
        elif line.startswith(" -4  STRESS"):
            arr = np.zeros((n_nodes, 6), dtype=np.float64)
            i += 1
            while i < n_lines and not lines[i].startswith(" -3"):
                s = lines[i]
                if s.startswith(" -1"):
                    nid = int(s[3:13]) - 1
                    for k in range(6):
                        arr[nid, k] = float(s[13 + 12 * k : 25 + 12 * k])
                i += 1
            steps_s.append(arr)
        i += 1

    results = []
    for u, st in zip(steps_u, steps_s):
        sxx, syy, szz, sxy, syz, sxz = st[:, 0], st[:, 1], st[:, 2], st[:, 3], st[:, 4], st[:, 5]
        vm = np.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2 + 6.0 * (sxy ** 2 + syz ** 2 + sxz ** 2)))
        results.append({"U": u, "S": st, "vm": vm})
    return results


def parse_dat_totals(dat_path: str):
    """Parse total reaction forces lines from .dat."""
    totals = []
    if not dat_path:
        return totals
    with open(dat_path, "r", errors="replace") as f:
        txt = f.read()
    for m in re.finditer(r"total force \(fx,fy,fz\) for set\s+(\S+)\s+and time\s+\S+\s*\n\s*([-\d.E+]+)\s+([-\d.E+]+)\s+([-\d.E+]+)", txt):
        totals.append((m.group(1), float(m.group(2)), float(m.group(3)), float(m.group(4))))
    return totals
