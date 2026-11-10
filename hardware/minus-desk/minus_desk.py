"""Minus, the desk buddy: a printable body for a CYD (ESP32 touchscreen) whose screen is its face.

The outline is the same as the mascot in the app (site/js/shape.js): a core circle and eight
lobes, smoothly joined. Two parts, both print face-down with no supports:

  minus-front.stl  the body. The screen sits behind the face window and shows Minus's eyes.
  minus-back.stl   the back cover. It presses in, and its posts hold the board against the face.

Change the numbers in PARAMS (millimetres) and run:  python3 minus_desk.py
Needs: pip install manifold3d numpy
"""
import math
import struct
import sys
from pathlib import Path

import manifold3d as m3
import numpy as np

PARAMS = dict(
    # the body
    R=60.0,             # widest radius: the body is 2R wide (120 mm)
    depth=40.0,         # front to back
    back=8.0,           # how much of the depth is the back cover
    wall=2.6,           # side walls
    face=2.0,           # the face (in front of the screen)
    tilt=10.0,          # degrees the face leans back when it stands on your desk
    floor=0.80,         # where the flat bottom is cut, as a fraction of R below the centre
    # the screen: the window is its visible area (make it a little smaller than the active area)
    win_w=56.6, win_h=42.4, win_r=2.5, win_y=0.04,   # win_y: centre height as a fraction of R (eye height)
    disp_w=70.0, disp_h=50.6,                        # the display module's outline, for the corner guides
    disp_stack=4.4,     # from the front of the glass to the front of the board
    # the board (CYD ESP32-2432S028: 86 x 50 x 1.6); dx/dy move it relative to the window centre
    pcb_w=86.0, pcb_h=50.0, pcb_t=1.6, pcb_dx=0.0, pcb_dy=0.0,
    # the USB plug: a slot on the right side, through to the board's edge
    usb_side=1,         # 1 = right, -1 = left (as you look at the face)
    usb_w=13.0,         # along the board edge
    usb_h=9.0,          # through the depth
    usb_dy=0.0,         # move it up/down along the edge (from the board's centre)
    usb_dz=1.5,         # its centre behind the board's back face
    fit=0.25,           # clearance where parts meet
)

LOBES = [(0.00, 0.640, 0.372), (0.05, 0.628, 0.378), (-0.03, 0.650, 0.362), (0.04, 0.636, 0.380),
         (-0.02, 0.646, 0.366), (0.03, 0.632, 0.376), (-0.05, 0.648, 0.362), (0.02, 0.636, 0.374)]
CIRCLES = [(0.0, 0.0, 0.72)] + [(math.cos(math.pi / 2 + i * math.pi / 4 + da) * d,
                                 math.sin(math.pi / 2 + i * math.pi / 4 + da) * d, r) for i, (da, d, r) in enumerate(LOBES)]
SOFT = 26.0
N = 720  # points around the outline


def outline():
    """Radius (body radius = 1) at N angles: a smooth union of the circles, as in shape.js."""
    t = np.linspace(0, 2 * math.pi, N, endpoint=False)
    ux, uy = np.cos(t), np.sin(t)
    acc = np.zeros(N)
    for cx, cy, r in CIRCLES:
        b = ux * cx + uy * cy
        disc = b * b - (cx * cx + cy * cy) + r * r
        d = b + np.sqrt(np.maximum(disc, 0))
        acc += np.where((disc >= 0) & (d > 0), np.exp(SOFT * d), 0)
    rad = np.log(acc) / SOFT
    return t, rad / rad.max()


def edge_profile(depth):
    """(inset, z) down the side, front to back: a 45 degree start (prints face-down with no
    supports), rounding into straight sides, and the same at the back."""
    rho, v1 = 7.0, 2.5
    cv = v1 + math.sqrt(0.5) * rho
    u0 = -(1 - math.sqrt(0.5)) * rho - v1
    front = [(u0, 0.0)]
    for k in range(9):
        a = math.radians(45 + 45 * k / 8)
        front.append((-rho + rho * math.sin(a), cv - rho * math.cos(a)))
    back = [(u, depth - v) for u, v in reversed(front)]
    return front + back


def inset_at(profile, z):
    us, zs = zip(*profile)
    return float(np.interp(z, zs, us))


def body_mesh(t, rad, R, profile):
    """A closed mesh: rings following the profile, plus flat front and back."""
    ring = []
    for u, z in profile:
        rr = rad * R + u
        ring.append(np.stack([rr * np.cos(t), rr * np.sin(t), np.full(N, z)], axis=1))
    verts = np.concatenate(ring + [np.array([[0, 0, profile[0][1]], [0, 0, profile[-1][1]]])])
    c0, c1 = len(verts) - 2, len(verts) - 1
    tris = []
    i = np.arange(N); j = (i + 1) % N
    for k in range(len(profile) - 1):
        a, b = k * N + i, k * N + j
        c, d = (k + 1) * N + j, (k + 1) * N + i
        tris += [np.stack([a, b, c], 1), np.stack([a, c, d], 1)]
    last = (len(profile) - 1) * N
    tris.append(np.stack([np.full(N, c0), j, i], 1))
    tris.append(np.stack([np.full(N, c1), last + i, last + j], 1))
    mesh = m3.Mesh(vert_properties=verts.astype(np.float32), tri_verts=np.concatenate(tris).astype(np.uint32))
    solid = m3.Manifold(mesh)
    assert solid.status() == m3.Error.NoError, solid.status()
    return solid


def roundrect(w, h, r):
    return m3.CrossSection.square((w - 2 * r, h - 2 * r), center=True).offset(r, m3.JoinType.Round, circular_segments=48)


def box(x0, x1, y0, y1, z0, z1):
    return m3.Manifold.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))


def build(P):
    t, rad = outline()
    R, D = P['R'], P['depth']
    split = D - P['back']
    outer = edge_profile(D)
    body = body_mesh(t, rad, R, outer)

    # the flat bottom it stands on, tilted so the face looks up at you
    tau = math.radians(P['tilt'])
    n = (0.0, math.cos(tau), -math.sin(tau))
    c = -P['floor'] * R * math.cos(tau) - (D / 2) * math.sin(tau)
    body = body.trim_by_plane(n, c)

    # inside: the outside moved in by the wall, from behind the face to the back cover's inside
    zs = sorted({z for _, z in outer if P['face'] < z < D - P['face']} | {P['face'], D - P['face']})
    inner = [(inset_at(outer, z) - P['wall'], z) for z in zs]
    cavity = body_mesh(t, rad, R, inner).trim_by_plane(n, c + P['wall'])

    front = body.trim_by_plane((0, 0, -1), -split) - cavity
    back = body.trim_by_plane((0, 0, 1), split) - cavity

    # the face window, with a soft chamfer on the outside
    wy = P['win_y'] * R
    win = m3.Manifold.extrude(roundrect(P['win_w'], P['win_h'], P['win_r']), P['face'] + 2).translate((0, wy, -1))
    bev = 1.2
    chamfer = m3.Manifold.hull(m3.Manifold.batch_boolean([
        m3.Manifold.extrude(roundrect(P['win_w'] + 2 * bev, P['win_h'] + 2 * bev, P['win_r'] + bev), 0.01).translate((0, wy, -0.01)),
        m3.Manifold.extrude(roundrect(P['win_w'], P['win_h'], P['win_r']), 0.01).translate((0, wy, bev)),
    ], m3.OpType.Add))
    front = front - win - chamfer

    # corner guides that hold the display square behind the window
    gw, gh = P['disp_w'] / 2 + P['fit'], P['disp_h'] / 2 + P['fit']
    gz0, gz1, th, leg = P['face'], P['face'] + min(3.0, P['disp_stack'] - 0.5), 1.6, 9.0
    guides = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            x_out, y_out = sx * gw, wy + sy * gh
            guides.append(box(min(x_out, x_out + sx * th), max(x_out, x_out + sx * th), min(y_out - sy * leg, y_out + sy * th), max(y_out - sy * leg, y_out + sy * th), gz0, gz1))
            guides.append(box(min(x_out - sx * leg, x_out + sx * th), max(x_out - sx * leg, x_out + sx * th), min(y_out, y_out + sy * th), max(y_out, y_out + sy * th), gz0, gz1))
    front = front + m3.Manifold.batch_boolean(guides, m3.OpType.Add)

    # the board sits right behind the display; check it fits inside with room to spare
    pcx, pcy = P['pcb_dx'], wy + P['pcb_dy']
    pcb_front = P['face'] + P['disp_stack']
    pcb_back = pcb_front + P['pcb_t']
    board = box(pcx - P['pcb_w'] / 2, pcx + P['pcb_w'] / 2, pcy - P['pcb_h'] / 2, pcy + P['pcb_h'] / 2, pcb_front, pcb_back)
    clash = (board - cavity).volume()
    if clash > 1e-3:
        sys.exit(f"The board doesn't fit inside (it pokes {clash:.0f} mm³ into the walls). Make R bigger, or move it with pcb_dx/pcb_dy.")

    # the USB slot, from the board's edge out through the side
    s = P['usb_side']
    edge = pcx + s * P['pcb_w'] / 2
    uz = pcb_back + P['usb_dz']
    slot = m3.Manifold.extrude(roundrect(P['usb_h'], P['usb_w'], min(P['usb_h'], P['usb_w']) / 2 - 0.5), R).rotate((0, 90, 0))
    slot = slot.translate((edge - s * 3 if s > 0 else edge - R + 3, pcy + P['usb_dy'], uz)) if s > 0 else slot.translate((edge - R + 3, pcy + P['usb_dy'], uz))
    front = front - slot

    # the back cover: a ring that presses into the body, and posts that hold the board forward
    ring_out = m3.CrossSection([np.stack([(rad * R - P['wall'] - P['fit']) * np.cos(t), (rad * R - P['wall'] - P['fit']) * np.sin(t)], 1)])
    ring_cs = ring_out - ring_out.offset(-1.8, m3.JoinType.Round)
    ring = m3.Manifold.extrude(ring_cs, 5.0).translate((0, 0, split - 5.0)).trim_by_plane(n, c + P['wall'] + P['fit'])
    posts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = pcx + sx * (P['pcb_w'] / 2 - 5), pcy + sy * (P['pcb_h'] / 2 - 5)
            posts.append(m3.Manifold.cylinder(D - P['face'] - pcb_back - 0.4, 2.5, 2.5, 32).translate((px, py, pcb_back + 0.4)))
    back = back + ring + m3.Manifold.batch_boolean(posts, m3.OpType.Add)

    # lay the cover on its back for printing
    back = back.mirror((0, 0, 1)).translate((0, 0, D))
    return front, back, dict(width=float(2 * R), height=None)


def save_stl(solid, path):
    mesh = solid.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3]
    f = np.asarray(mesh.tri_verts)
    tri = v[f]
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    with open(path, 'wb') as fh:
        fh.write(b'Minus desk buddy'.ljust(80, b' '))
        fh.write(struct.pack('<I', len(f)))
        rec = np.zeros(len(f), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
        rec['n'], rec['v'] = nrm, tri
        fh.write(rec.tobytes())
    return len(f)


if __name__ == '__main__':
    out = Path(__file__).parent
    front, back, _ = build(PARAMS)
    for name, part in (('minus-front.stl', front), ('minus-back.stl', back)):
        n = save_stl(part, out / name)
        lo, hi = part.bounding_box()[:3], part.bounding_box()[3:]
        print(f"{name}: {n} triangles, {hi[0]-lo[0]:.1f} x {hi[1]-lo[1]:.1f} x {hi[2]-lo[2]:.1f} mm, {part.volume()/1000:.1f} cm³")
