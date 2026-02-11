from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from mockup_manager.processor import process_image_file


def _create_image(path: Path, size: tuple[int, int], draw_subject) -> None:
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    draw_subject(draw, size)
    image.save(path)


def test_horizontal_image_outputs_exact_800(tmp_path: Path) -> None:
    input_path = tmp_path / "horizontal.png"
    output_dir = tmp_path / "out"
    output_dir.mkdir()

    def draw_subject(draw: ImageDraw.ImageDraw, size: tuple[int, int]) -> None:
        w, h = size
        draw.rectangle((w * 0.4, h * 0.25, w * 0.6, h * 0.75), fill=(20, 170, 20))

    _create_image(input_path, (1600, 900), draw_subject)
    result = process_image_file(input_path, output_dir, overwrite=True, safe_mode=False)

    assert result.status == "ok"
    with Image.open(result.output_path) as out:
        assert out.size == (800, 800)
        center = out.getpixel((400, 400))
    assert center[1] > 120


def test_vertical_image_outputs_exact_800(tmp_path: Path) -> None:
    input_path = tmp_path / "vertical.png"
    output_dir = tmp_path / "out"
    output_dir.mkdir()

    def draw_subject(draw: ImageDraw.ImageDraw, size: tuple[int, int]) -> None:
        w, h = size
        draw.rectangle((w * 0.25, h * 0.4, w * 0.75, h * 0.6), fill=(180, 30, 30))

    _create_image(input_path, (900, 1600), draw_subject)
    result = process_image_file(input_path, output_dir, overwrite=True, safe_mode=False)

    assert result.status == "ok"
    with Image.open(result.output_path) as out:
        assert out.size == (800, 800)
        center = out.getpixel((400, 400))
    assert center[0] > 120


def test_centered_subject_kept_centered(tmp_path: Path) -> None:
    input_path = tmp_path / "centered.jpg"
    output_dir = tmp_path / "out"
    output_dir.mkdir()

    def draw_subject(draw: ImageDraw.ImageDraw, size: tuple[int, int]) -> None:
        w, h = size
        radius = min(w, h) * 0.2
        cx, cy = w * 0.5, h * 0.5
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(30, 80, 190))

    _create_image(input_path, (1200, 1200), draw_subject)
    result = process_image_file(input_path, output_dir, overwrite=True, safe_mode=True)

    assert result.status == "ok"
    with Image.open(result.output_path) as out:
        assert out.size == (800, 800)
        center = out.getpixel((400, 400))
    assert center[2] > 120
