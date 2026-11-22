"""Fast, 100% deterministic STL -> CalculiX C3D8I (incompatible-modes bending brick) FEA solver."""
import os, time, subprocess
import numpy as np
import trimesh


def stl_to_c3d8i(stl_path: str, pitch_xy: float = 1.6, pitch_z: float = 1.0):
    mesh = trimesh.load_mesh(stl_path, process=True)
    if not mesh.is_watertight:
        raise RuntimeError(f"Non-watertight mesh: {stl_path}")
    # Scale Z by (pitch_xy / pitch_z) so trimesh voxelizes at anisotropic resolution (pitch_xy, pitch_xy, pitch_z)!
    scale_z = pitch_xy / pitch_z
    m_scaled = mesh.copy()
    m_scaled.vertices[:, 2] *= scale_z
    vg = m_scaled.voxelized(pitch=pitch_xy).fill()
    ijk = vg.sparse_indices  # (Ne, 3) integer voxel indices
    centers_scaled = vg.indices_to_points(ijk)
    centers = centers_scaled.copy()
    centers[:, 2] /= scale_z

    # Build unique corner nodes on integer lattice (i+di, j+dj, k+dk)
    # Abaqus/CalculiX C3D8/C3D8I node order:
    # bottom (-z): (0,0,0), (1,0,0), (1,1,0), (0,1,0); top (+z): (0,0,1), (1,0,1), (1,1,1), (0,1,1)
    offsets = np.array([
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ], dtype=np.int64)
    all_corners_ijk = (ijk[:, None, :] + offsets[None, :, :]).reshape(-1, 3)
    uniq_ijk, inv = np.unique(all_corners_ijk, axis=0, return_inverse=True)
    hex8 = inv.reshape(-1, 8)

    # Convert lattice corners to exact world mm coordinates
    origin_center = vg.indices_to_points(np.zeros((1, 3)))[0]
    origin_corner = origin_center - 0.5 * pitch_xy
    nodes = origin_corner[None, :] + uniq_ijk.astype(np.float64) * pitch_xy
    nodes[:, 2] /= scale_z

    elem_vol = (pitch_xy ** 2) * pitch_z
    vols = np.full(len(hex8), elem_vol, dtype=np.float64)
    return nodes, hex8, centers, vols, float(mesh.volume)
