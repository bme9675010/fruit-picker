# 產生主畫面圖示（iPhone 不支援 SVG 圖示，Android 安裝也需要 PNG）。
# 用法：python tools/make-icons.py
import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
BG = (20, 17, 15)
SS = 4  # 先畫大 4 倍再縮小，邊緣比較平滑


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size):
    s = size * SS
    img = Image.new('RGB', (s, s), BG)
    # 芒果：旋轉的橢圓，從右上金黃漸層到左下橘紅；放在中央 70% 內（maskable 安全範圍）
    mango = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mango).ellipse([s * 0.26, s * 0.18, s * 0.74, s * 0.86], fill=255)
    mango = mango.rotate(-32, resample=Image.BICUBIC, center=(s / 2, s * 0.53))
    grad = Image.new('RGB', (s, s))
    px = grad.load()
    for y in range(0, s, SS):
        for x in range(0, s, SS):
            t = min(1, max(0, ((x / s) * -0.6 + (y / s) * 0.9)))
            c = lerp((255, 205, 60), (232, 84, 46), t)
            for dy in range(SS):
                for dx in range(SS):
                    px[x + dx, y + dy] = c
    img.paste(grad, (0, 0), mango)
    # 高光
    hl = Image.new('L', (s, s), 0)
    ImageDraw.Draw(hl).ellipse([s * 0.52, s * 0.28, s * 0.62, s * 0.44], fill=90)
    hl = hl.rotate(-32, resample=Image.BICUBIC, center=(s / 2, s * 0.53))
    img.paste((255, 245, 210), (0, 0), hl)
    # 葉子與果柄
    d = ImageDraw.Draw(img)
    d.line([(s * 0.60, s * 0.22), (s * 0.66, s * 0.14)], fill=(110, 72, 40), width=int(s * 0.025))
    leaf = [(s * 0.63, s * 0.17)]
    for i in range(0, 181, 10):
        a = math.radians(i)
        leaf.append((s * 0.63 + s * 0.17 * (i / 180), s * 0.17 - s * 0.07 * math.sin(a)))
    for i in range(180, -1, -10):
        a = math.radians(i)
        leaf.append((s * 0.63 + s * 0.17 * (i / 180), s * 0.17 + s * 0.02 * math.sin(a)))
    d.polygon(leaf, fill=(98, 176, 72))
    return img.resize((size, size), Image.LANCZOS)


for name, size in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)]:
    draw_icon(size).save(ROOT / name, optimize=True)
    print(name)
