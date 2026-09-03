"""
Voxel models.

Only two vertical faces of a cube are ever visible in this projection: the +z
face (screen-left) and the +x face (screen-right). Anything meant to be seen —
eyes, a mouth, a notch — has to sit on the outermost layer of one of those two,
or it is simply buried inside the solid.
"""
from vox import render, box
from PIL import Image, ImageDraw

INK    = "#26241f"
PAPER  = "#efece5"
WOOD   = "#c8912f"
ACCENT = "#b4552d"
DESK   = "#7a6248"

SKINS  = ["#e6c4a0", "#c68f63", "#8d5f3f"]
HAIRS  = ["#332f29", "#5a4432", "#c9a86f", "#1f1d1a"]
SHIRTS = ["#88a49b", "#a9857e", "#7d8bab", "#b09a6a"]


def figure(v, ox, oz, *, skin=0, hair=0, shirt=0, arm=None, height=5, style="long"):
    """
    A person standing on y=0, facing +x (screen-right).
    Head is 4 wide (x), 4 deep (z); the face plane is the +x surface.
    """
    sk, hr, sh = SKINS[skin], HAIRS[hair], SHIRTS[shirt]
    H = height

    # Head is 5 deep so the two eyes can sit either side of a gap; at 4 deep
    # they land on adjacent voxels and merge into one dark bar.
    box(v, ox, 0, oz, 4, H, 5, sh)                       # torso
    box(v, ox, H, oz, 4, 4, 5, sk)                       # head
    # Two silhouettes, not just two palettes: at 28px colour alone does not
    # separate two characters, but an outline does.
    if style == "long":
        box(v, ox, H + 4, oz - 1, 4, 1, 7, hr)           # crown
        box(v, ox - 1, H + 1, oz - 1, 1, 3, 7, hr)       # back of the head
        for z in (oz - 1, oz + 5):                       # hair down both sides
            box(v, ox, H + 1, z, 4, 3, 1, hr)
    else:                                                # cropped
        box(v, ox, H + 4, oz, 4, 1, 5, hr)
        box(v, ox - 1, H + 3, oz, 1, 1, 5, hr)

    fx = ox + 3                                          # the face plane (+x)
    v[(fx, H + 2, oz + 1)] = INK                         # eyes, with a gap
    v[(fx, H + 2, oz + 3)] = INK
    v[(fx, H, oz + 2)] = "#a86a52"                       # mouth

    if arm:                                              # a reaching arm
        d = 1 if arm == "right" else -1
        x = ox + 4 if d > 0 else ox - 1
        for i in range(3):
            v[(x + d * i, H - 2, oz + 1)] = sk
    return v


def ground(v, x0, z0, w, dp, colour=PAPER):
    box(v, x0, -1, z0, w, 1, dp, colour)
    return v


def stick(v, x0, y, z, length, notches):
    """A notched stick. Notches sit on the top face so they read from above."""
    for x in range(x0, x0 + length):
        v[(x, y, z)] = WOOD
        v[(x, y, z + 1)] = WOOD
    for n in notches:
        v[(x0 + n, y + 1, z)] = ACCENT
        v[(x0 + n, y + 1, z + 1)] = ACCENT
    return v


def label(sheet, x, y, text, fill="#8a8378", size=None):
    d = ImageDraw.Draw(sheet)
    d.text((x, y), text, fill=fill)
    return sheet


def contact_shadow(img, cx, cy, rx, ry, alpha=34):
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(0, 0, 0, alpha))
    return Image.alpha_composite(sh, img)
