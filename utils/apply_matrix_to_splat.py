import numpy as np
import re
from pathlib import Path


def parse_matrix_file(path):
    text = Path(path).read_text().strip()
    vals = [float(x) for x in re.split(r'[,]+', text) if x]
    if len(vals) != 16:
        raise ValueError(f"Expected 16 matrix values, got {len(vals)}")
    # THREE.js Matrix4.elements is column-major
    return np.array(vals, dtype=np.float64).reshape(4, 4, order='F')


def read_ply(path):
    with open(path, 'rb') as f:
        header_bytes = b''
        while True:
            line = f.readline()
            header_bytes += line
            if line.strip() == b'end_header':
                break
        data = f.read()

    header = header_bytes.decode('ascii')
    lines = [l.strip() for l in header.split('\n')]

    n_points = 0
    for l in lines:
        if l.startswith('element vertex'):
            n_points = int(l.split()[-1])

    properties = []
    for l in lines:
        if l.startswith('property') and not l.startswith('property list'):
            parts = l.split()
            properties.append((parts[2], parts[1]))

    format_line = next(l for l in lines if l.startswith('format'))
    is_binary_le = 'binary_little_endian' in format_line
    is_binary_be = 'binary_big_endian' in format_line

    dtype_map = {
        'float': 'f4', 'float32': 'f4',
        'double': 'f8', 'float64': 'f8',
        'int': 'i4', 'int32': 'i4',
        'uint': 'u4', 'uint32': 'u4',
        'uchar': 'u1', 'uint8': 'u1',
        'char': 'i1', 'int8': 'i1',
        'short': 'i2', 'int16': 'i2',
        'ushort': 'u2', 'uint16': 'u2',
    }

    if is_binary_le or is_binary_be:
        bo = '<' if is_binary_le else '>'
        dt = np.dtype([(name, bo + dtype_map[t]) for name, t in properties])
        arr = np.frombuffer(data, dtype=dt, count=n_points).copy()
    else:
        rows = [list(map(float, l.split())) for l in data.decode('ascii').strip().split('\n')[:n_points]]
        dt = np.dtype([(name, dtype_map[t]) for name, t in properties])
        arr = np.array([tuple(r) for r in rows], dtype=dt)

    return arr, header, is_binary_le, is_binary_be


def write_ply(path, arr, header, as_binary_le=True):
    lines = header.split('\n')
    out_lines = []
    for l in lines:
        stripped = l.strip()
        if stripped.startswith('format'):
            out_lines.append('format binary_little_endian 1.0')
        else:
            out_lines.append(l)
    out_header = '\n'.join(out_lines)
    if not out_header.endswith('\n'):
        out_header += '\n'

    out_dt = np.dtype([(name, '<' + arr.dtype[name].str.lstrip('=<>|')) for name in arr.dtype.names])
    with open(path, 'wb') as f:
        f.write(out_header.encode('ascii'))
        f.write(arr.astype(out_dt).tobytes())


def quats_to_rotmats(quats):
    w, x, y, z = quats[:, 0], quats[:, 1], quats[:, 2], quats[:, 3]
    N = len(quats)
    R = np.zeros((N, 3, 3))
    R[:, 0, 0] = 1 - 2*(y*y + z*z)
    R[:, 0, 1] = 2*(x*y - w*z)
    R[:, 0, 2] = 2*(x*z + w*y)
    R[:, 1, 0] = 2*(x*y + w*z)
    R[:, 1, 1] = 1 - 2*(x*x + z*z)
    R[:, 1, 2] = 2*(y*z - w*x)
    R[:, 2, 0] = 2*(x*z - w*y)
    R[:, 2, 1] = 2*(y*z + w*x)
    R[:, 2, 2] = 1 - 2*(x*x + y*y)
    return R


def rotmats_to_quats(R):
    # Shepperd's method, vectorized; returns [w, x, y, z]
    N = len(R)
    quats = np.zeros((N, 4))
    trace = R[:, 0, 0] + R[:, 1, 1] + R[:, 2, 2]

    m00, m11, m22 = R[:, 0, 0], R[:, 1, 1], R[:, 2, 2]
    m21_12 = R[:, 2, 1] - R[:, 1, 2]
    m02_20 = R[:, 0, 2] - R[:, 2, 0]
    m10_01 = R[:, 1, 0] - R[:, 0, 1]
    m01_10 = R[:, 0, 1] + R[:, 1, 0]
    m02_20p = R[:, 0, 2] + R[:, 2, 0]
    m12_21p = R[:, 1, 2] + R[:, 2, 1]

    c0 = trace > 0
    c1 = (~c0) & (m00 > m11) & (m00 > m22)
    c2 = (~c0) & (~c1) & (m11 > m22)
    c3 = (~c0) & (~c1) & (~c2)

    s = np.where(c0, 0.5 / np.sqrt(np.maximum(trace + 1.0, 1e-10)), 0.0)
    quats[c0, 0] = 0.25 / s[c0]
    quats[c0, 1] = m21_12[c0] * s[c0]
    quats[c0, 2] = m02_20[c0] * s[c0]
    quats[c0, 3] = m10_01[c0] * s[c0]

    s = np.where(c1, 2.0 * np.sqrt(np.maximum(1.0 + m00 - m11 - m22, 1e-10)), 1.0)
    quats[c1, 0] = m21_12[c1] / s[c1]
    quats[c1, 1] = 0.25 * s[c1]
    quats[c1, 2] = m01_10[c1] / s[c1]
    quats[c1, 3] = m02_20p[c1] / s[c1]

    s = np.where(c2, 2.0 * np.sqrt(np.maximum(1.0 + m11 - m00 - m22, 1e-10)), 1.0)
    quats[c2, 0] = m02_20[c2] / s[c2]
    quats[c2, 1] = m01_10[c2] / s[c2]
    quats[c2, 2] = 0.25 * s[c2]
    quats[c2, 3] = m12_21p[c2] / s[c2]

    s = np.where(c3, 2.0 * np.sqrt(np.maximum(1.0 + m22 - m00 - m11, 1e-10)), 1.0)
    quats[c3, 0] = m10_01[c3] / s[c3]
    quats[c3, 1] = m02_20p[c3] / s[c3]
    quats[c3, 2] = m12_21p[c3] / s[c3]
    quats[c3, 3] = 0.25 * s[c3]

    norms = np.linalg.norm(quats, axis=1, keepdims=True)
    return quats / np.maximum(norms, 1e-10)


def polar_rotation(M3):
    U, _, Vt = np.linalg.svd(M3)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        U[:, -1] *= -1
        R = U @ Vt
    return R


def apply_transform(arr, M):
    M3 = M[:3, :3]
    t = M[:3, 3]
    fields = arr.dtype.names
    N = len(arr)

    # --- Positions ---
    pts = np.stack([arr['x'], arr['y'], arr['z']], axis=1).astype(np.float64)
    pts_new = pts @ M3.T + t
    arr['x'] = pts_new[:, 0].astype(arr['x'].dtype)
    arr['y'] = pts_new[:, 1].astype(arr['y'].dtype)
    arr['z'] = pts_new[:, 2].astype(arr['z'].dtype)

    rot_fields = ['rot_0', 'rot_1', 'rot_2', 'rot_3']
    scale_fields = ['scale_0', 'scale_1', 'scale_2']
    has_rot = all(f in fields for f in rot_fields)
    has_scale = all(f in fields for f in scale_fields)

    if has_rot and has_scale:
        quats = np.stack([arr[f] for f in rot_fields], axis=1).astype(np.float64)
        quats /= np.maximum(np.linalg.norm(quats, axis=1, keepdims=True), 1e-10)

        log_scales = np.stack([arr[f] for f in scale_fields], axis=1).astype(np.float64)
        scales = np.exp(log_scales)

        Rg = quats_to_rotmats(quats)

        # A[i] = M3 @ Rg[i] @ diag(scales[i])
        # Covariance = A @ A^T = U @ diag(s^2) @ U^T → new rot=U, new scale=s
        RS = Rg * scales[:, np.newaxis, :]
        A = np.einsum('ij,njk->nik', M3, RS)

        U, s_new, _ = np.linalg.svd(A)

        # Enforce proper rotation (det = +1)
        dets = np.linalg.det(U)
        flip = dets < 0
        U[flip, :, 2] *= -1
        s_new[flip, 2] *= -1
        s_new = np.abs(s_new)

        new_quats = rotmats_to_quats(U)
        new_log_scales = np.log(np.maximum(s_new, 1e-10))

        for i, f in enumerate(rot_fields):
            arr[f] = new_quats[:, i].astype(arr[f].dtype)
        for i, f in enumerate(scale_fields):
            arr[f] = new_log_scales[:, i].astype(arr[f].dtype)

    elif has_rot:
        R = polar_rotation(M3)
        quats = np.stack([arr[f] for f in rot_fields], axis=1).astype(np.float64)
        quats /= np.maximum(np.linalg.norm(quats, axis=1, keepdims=True), 1e-10)
        Rg = quats_to_rotmats(quats)
        Rg_new = np.einsum('ij,njk->nik', R, Rg)
        new_quats = rotmats_to_quats(Rg_new)
        for i, f in enumerate(rot_fields):
            arr[f] = new_quats[:, i].astype(arr[f].dtype)

    # --- Degree-1 SH rotation ---
    # SH l=1 basis (Y_{-1}, Y_0, Y_1) corresponds spatially to (y, z, x)
    # Rotation matrix in this basis: R_sh[i,j] = R[perm[i], perm[j]], perm=[1,2,0]
    R_pure = polar_rotation(M3)
    perm = [1, 2, 0]
    R_sh1 = R_pure[np.ix_(perm, perm)]

    sh1_fields = [f'f_rest_{i}' for i in range(9)]
    if all(f in fields for f in sh1_fields):
        for ch in range(3):
            vecs = np.stack([arr[f'f_rest_{ch*3+i}'] for i in range(3)], axis=1).astype(np.float64)
            rotated = vecs @ R_sh1.T
            for i in range(3):
                arr[f'f_rest_{ch*3+i}'] = rotated[:, i].astype(arr[f'f_rest_{ch*3+i}'].dtype)

    return arr


def main():
    data_dir = Path(__file__).parent.parent / 'air_sim' / 'backend' / 'data' / 'lab'
    matrix_file = Path(__file__).parent / 'matrix.txt'
    splat = data_dir / 'splat.ply'
    splat_old = data_dir / 'splat.old.ply'

    if splat_old.exists():
        splat_old.unlink()
        print(f'Deleted {splat_old}')

    splat.rename(splat_old)
    print(f'Renamed splat.ply → splat.old.ply')

    M_exported = parse_matrix_file(matrix_file)

    # M_exported is in THREE.js world space (PLY→world, including base RotX(-π/2)).
    # After baking, the renderer re-applies RotX(-π/2) on load, so we must
    # pre-multiply by RotX(+π/2) to cancel it: M_ply = RotX(π/2) @ M_exported
    Rx90 = np.array([
        [1, 0,  0, 0],
        [0, 0, -1, 0],
        [0, 1,  0, 0],
        [0, 0,  0, 1],
    ], dtype=np.float64)
    M = Rx90 @ M_exported
    print(f'Transform matrix (PLY space):\n{M}')

    arr, header, is_le, is_be = read_ply(splat_old)
    print(f'Loaded {len(arr)} Gaussians')

    arr = apply_transform(arr, M)
    write_ply(splat, arr, header)
    print(f'Saved → {splat}')


if __name__ == '__main__':
    main()
