"""
Isometric voxel renderer.

Each voxel is a cube drawn as three rhombi — top, left, right — at three shades
of one colour, which is what gives flat pixel art its read of depth. Painter's
algorithm handles occlusion: far voxels first, near voxels last.

Rendered small and nearest-upscaled, so the pixel grid stays crisp instead of
being smoothed away.
"""
from PIL import Image, ImageDraw

S = 6  # half-width of a cube in source pixels


def shades(hex_colour):
    """Top, left, right. Left is the lit face, right falls away."""
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    def mul(f):
        return (min(255, int(r * f)), min(255, int(g * f)), min(255, int(b * f)))
    return mul(1.0), mul(0.78), mul(0.58)


def project(x, y, z, ox, oy):
    """World (x, y up, z) -> screen. Classic 2:1 isometric."""
    return ox + (x - z) * S, oy + (x + z) * (S // 2) - y * S


def draw_voxel(d, x, y, z, colour, ox, oy):
    top, left, right = shades(colour)
    px, py = project(x, y, z, ox, oy)
    h = S // 2
    # top face
    d.polygon([(px, py - h), (px + S, py), (px, py + h), (px - S, py)], fill=top)
    # left face
    d.polygon([(px - S, py), (px, py + h), (px, py + h + S), (px - S, py + S)], fill=left)
    # right face
    d.polygon([(px + S, py), (px, py + h), (px, py + h + S), (px + S, py + S)], fill=right)


def render(voxels, size=(420, 360), origin=None, bg=None, scale=3):
    """voxels: dict of (x, y, z) -> colour hex."""
    img = Image.new("RGBA", size, bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ox, oy = origin or (size[0] // 2, size[1] // 2)
    # far to near: increasing x + z, then bottom to top
    for (x, y, z) in sorted(voxels, key=lambda p: (p[0] + p[2], p[1])):
        draw_voxel(d, x, y, z, voxels[(x, y, z)], ox, oy)
    if scale > 1:
        img = img.resize((size[0] * scale, size[1] * scale), Image.NEAREST)
    return img


# ----------------------------------------------------------------- helpers

def box(vox, x0, y0, z0, w, h, dp, colour):
    for x in range(x0, x0 + w):
        for y in range(y0, y0 + h):
            for z in range(z0, z0 + dp):
                vox[(x, y, z)] = colour
    return vox


def shell(vox, x0, y0, z0, w, h, dp, colour):
    """Hollow box — only the outer layer, which is all that is ever visible."""
    for x in range(x0, x0 + w):
        for y in range(y0, y0 + h):
            for z in range(z0, z0 + dp):
                edge = (x in (x0, x0 + w - 1) or y in (y0, y0 + h - 1) or z in (z0, z0 + dp - 1))
                if edge:
                    vox[(x, y, z)] = colour
    return vox
