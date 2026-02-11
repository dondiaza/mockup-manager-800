from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
from PIL import Image, ImageFilter, ImageOps

TARGET_SIZE = (800, 800)
SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}


@dataclass(slots=True)
class ProcessResult:
    input_path: Path
    output_path: Path
    status: str
    message: str
    crop_method: str = "fallback_center"


def is_supported_image(path: Path | str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS


def collect_images_from_directory(directory: Path | str, recursive: bool = True) -> list[Path]:
    base_dir = Path(directory)
    if not base_dir.exists():
        return []

    iterator = base_dir.rglob("*") if recursive else base_dir.glob("*")
    files = [path for path in iterator if path.is_file() and is_supported_image(path)]
    return sorted(files)


def build_output_path(input_path: Path, output_dir: Path) -> Path:
    return output_dir / f"{input_path.stem}_800.jpg"


def _center_crop_box(width: int, height: int) -> tuple[int, int, int, int]:
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return left, top, left + side, top + side


def _prepare_image(input_path: Path) -> tuple[Image.Image, bytes | None, bytes | None]:
    with Image.open(input_path) as source:
        icc_profile = source.info.get("icc_profile")

        exif_bytes: bytes | None = None
        try:
            exif_data = source.getexif()
            if exif_data:
                exif_data[274] = 1  # Orientation: normalized after exif_transpose
                exif_bytes = exif_data.tobytes()
        except Exception:
            exif_bytes = source.info.get("exif")

        image = ImageOps.exif_transpose(source)
        image.load()

    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba_image = image.convert("RGBA")
        white_bg = Image.new("RGBA", rgba_image.size, (255, 255, 255, 255))
        image = Image.alpha_composite(white_bg, rgba_image).convert("RGB")
    else:
        image = image.convert("RGB")

    return image, icc_profile, exif_bytes


def _compute_energy_map(image: Image.Image) -> np.ndarray:
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0

    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = np.abs(gray[:, 2:] - gray[:, :-2])
    gy[1:-1, :] = np.abs(gray[2:, :] - gray[:-2, :])
    gradient = gx + gy

    blurred = np.asarray(
        image.convert("L").filter(ImageFilter.GaussianBlur(radius=2.0)),
        dtype=np.float32,
    ) / 255.0
    contrast = np.abs(gray - blurred)

    energy = (gradient * 0.75) + (contrast * 0.25)
    energy -= float(energy.min())
    peak = float(energy.max())
    if peak > 1e-8:
        energy /= peak
    return energy


def _compute_salient_bbox(energy: np.ndarray) -> tuple[int, int, int, int] | None:
    percentile = 88.0
    threshold = float(np.percentile(energy, percentile))
    mask = energy >= threshold

    if int(mask.sum()) < max(16, int(energy.size * 0.002)):
        return None

    ys, xs = np.nonzero(mask)
    x0, x1 = int(xs.min()), int(xs.max() + 1)
    y0, y1 = int(ys.min()), int(ys.max() + 1)

    pad_x = max(2, int((x1 - x0) * 0.08))
    pad_y = max(2, int((y1 - y0) * 0.08))
    x0 = max(0, x0 - pad_x)
    y0 = max(0, y0 - pad_y)
    x1 = min(energy.shape[1], x1 + pad_x)
    y1 = min(energy.shape[0], y1 + pad_y)
    return x0, y0, x1, y1


def _sum_region(integral: np.ndarray, x: int, y: int, side: int) -> float:
    x2 = x + side
    y2 = y + side
    return float(integral[y2, x2] - integral[y, x2] - integral[y2, x] + integral[y, x])


def _intersection_ratio(
    crop_box: tuple[int, int, int, int],
    bbox: tuple[int, int, int, int] | None,
) -> float:
    if bbox is None:
        return 0.0

    x0 = max(crop_box[0], bbox[0])
    y0 = max(crop_box[1], bbox[1])
    x1 = min(crop_box[2], bbox[2])
    y1 = min(crop_box[3], bbox[3])

    if x1 <= x0 or y1 <= y0:
        return 0.0

    inter_area = (x1 - x0) * (y1 - y0)
    bbox_area = max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    return inter_area / bbox_area


def _score_candidate(
    *,
    x: int,
    y: int,
    side: int,
    width: int,
    height: int,
    energy_integral: np.ndarray,
    salient_bbox: tuple[int, int, int, int] | None,
    focus_center: tuple[float, float],
    safe_mode: bool,
) -> float:
    energy_score = _sum_region(energy_integral, x, y, side) / max(1.0, float(side * side))
    overlap_score = _intersection_ratio((x, y, x + side, y + side), salient_bbox)

    crop_cx = x + (side / 2.0)
    crop_cy = y + (side / 2.0)
    image_cx = width / 2.0
    image_cy = height / 2.0

    focus_dx = (crop_cx - focus_center[0]) / max(1.0, width)
    focus_dy = (crop_cy - focus_center[1]) / max(1.0, height)
    focus_dist = float(np.hypot(focus_dx, focus_dy))
    focus_score = 1.0 - min(1.0, focus_dist * 2.0)

    center_dx = (crop_cx - image_cx) / max(1.0, width)
    center_dy = (crop_cy - image_cy) / max(1.0, height)
    center_dist = float(np.hypot(center_dx, center_dy))
    center_score = 1.0 - min(1.0, center_dist * 2.0)

    if safe_mode:
        return (
            (energy_score * 0.55)
            + (overlap_score * 0.55)
            + (focus_score * 0.45)
            + (center_score * 0.35)
        )

    return (
        (energy_score * 0.75)
        + (overlap_score * 0.40)
        + (focus_score * 0.40)
        + (center_score * 0.15)
    )


def _smart_crop_box(image: Image.Image, safe_mode: bool) -> tuple[tuple[int, int, int, int], str]:
    width, height = image.size
    if width == height:
        return (0, 0, width, height), "already_square"

    max_side = max(width, height)
    if max_side > 512:
        scale = 512 / max_side
        scaled_size = (max(64, int(round(width * scale))), max(64, int(round(height * scale))))
        scaled = image.resize(scaled_size, Image.Resampling.BILINEAR)
    else:
        scaled = image

    sw, sh = scaled.size
    if sw == sh:
        return _center_crop_box(width, height), "smart_centered"

    energy = _compute_energy_map(scaled)
    if float(energy.max()) < 1e-8:
        return _center_crop_box(width, height), "fallback_center"

    salient_bbox = _compute_salient_bbox(energy)
    image_center = (sw / 2.0, sh / 2.0)
    if salient_bbox is not None:
        focus_center = (
            (salient_bbox[0] + salient_bbox[2]) / 2.0,
            (salient_bbox[1] + salient_bbox[3]) / 2.0,
        )
    else:
        focus_center = image_center

    if safe_mode:
        blend = 0.50
        focus_center = (
            (focus_center[0] * (1.0 - blend)) + (image_center[0] * blend),
            (focus_center[1] * (1.0 - blend)) + (image_center[1] * blend),
        )

    side = min(sw, sh)
    if side <= 0:
        return _center_crop_box(width, height), "fallback_center"

    energy_integral = np.pad(energy, ((1, 0), (1, 0)), mode="constant", constant_values=0.0)
    energy_integral = energy_integral.cumsum(axis=0).cumsum(axis=1)

    if sw > sh:
        movable = sw - side
        offsets = list(range(0, movable + 1))
        target_offset = int(round(focus_center[0] - (side / 2.0)))
        if target_offset not in offsets:
            offsets.append(max(0, min(movable, target_offset)))
        best_score = float("-inf")
        best_offset = movable // 2
        for x in offsets:
            score = _score_candidate(
                x=x,
                y=0,
                side=side,
                width=sw,
                height=sh,
                energy_integral=energy_integral,
                salient_bbox=salient_bbox,
                focus_center=focus_center,
                safe_mode=safe_mode,
            )
            if score > best_score:
                best_score = score
                best_offset = x

        side_original = height
        left = int(round(best_offset * (width / max(1, sw))))
        left = max(0, min(left, width - side_original))
        return (left, 0, left + side_original, side_original), "smart_saliency"

    movable = sh - side
    offsets = list(range(0, movable + 1))
    target_offset = int(round(focus_center[1] - (side / 2.0)))
    if target_offset not in offsets:
        offsets.append(max(0, min(movable, target_offset)))

    best_score = float("-inf")
    best_offset = movable // 2
    for y in offsets:
        score = _score_candidate(
            x=0,
            y=y,
            side=side,
            width=sw,
            height=sh,
            energy_integral=energy_integral,
            salient_bbox=salient_bbox,
            focus_center=focus_center,
            safe_mode=safe_mode,
        )
        if score > best_score:
            best_score = score
            best_offset = y

    side_original = width
    top = int(round(best_offset * (height / max(1, sh))))
    top = max(0, min(top, height - side_original))
    return (0, top, side_original, top + side_original), "smart_saliency"


def process_image_file(
    input_path: Path | str,
    output_dir: Path | str,
    *,
    overwrite: bool = False,
    safe_mode: bool = False,
) -> ProcessResult:
    src_path = Path(input_path)
    dst_dir = Path(output_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst_path = build_output_path(src_path, dst_dir)

    if not is_supported_image(src_path):
        return ProcessResult(src_path, dst_path, "error", "Formato no soportado.")

    if dst_path.exists() and not overwrite:
        return ProcessResult(src_path, dst_path, "skipped", "Ya existe (overwrite desactivado).")

    try:
        image, icc_profile, exif_bytes = _prepare_image(src_path)
    except Exception as exc:
        return ProcessResult(src_path, dst_path, "error", f"No se pudo abrir: {exc}")

    crop_method = "fallback_center"
    try:
        crop_box, crop_method = _smart_crop_box(image, safe_mode=safe_mode)
    except Exception:
        crop_box = _center_crop_box(*image.size)
        crop_method = "fallback_center"

    cropped = image.crop(crop_box)
    resized = cropped.resize(TARGET_SIZE, Image.Resampling.LANCZOS)

    save_kwargs: dict[str, object] = {
        "format": "JPEG",
        "quality": 100,
        "subsampling": 0,
        "optimize": False,
        "progressive": False,
    }
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    if exif_bytes:
        save_kwargs["exif"] = exif_bytes

    try:
        resized.save(dst_path, **save_kwargs)
    except Exception as exc:
        return ProcessResult(src_path, dst_path, "error", f"No se pudo guardar: {exc}", crop_method)

    return ProcessResult(src_path, dst_path, "ok", f"Exportado con {crop_method}.", crop_method)


def process_batch(
    input_paths: Iterable[Path | str],
    output_dir: Path | str,
    *,
    overwrite: bool = False,
    safe_mode: bool = False,
    workers: int = 3,
    progress_callback: Callable[[int, int, ProcessResult], None] | None = None,
) -> list[ProcessResult]:
    paths = [Path(path) for path in input_paths if is_supported_image(path)]
    if not paths:
        return []

    index_by_path = {path: index for index, path in enumerate(paths)}
    results: list[ProcessResult] = []
    total = len(paths)

    with ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as pool:
        future_map = {
            pool.submit(
                process_image_file,
                path,
                output_dir,
                overwrite=overwrite,
                safe_mode=safe_mode,
            ): path
            for path in paths
        }

        done = 0
        for future in as_completed(future_map):
            src_path = future_map[future]
            try:
                result = future.result()
            except Exception as exc:
                result = ProcessResult(
                    input_path=src_path,
                    output_path=build_output_path(src_path, Path(output_dir)),
                    status="error",
                    message=f"Error inesperado: {exc}",
                )
            done += 1
            results.append(result)
            if progress_callback:
                progress_callback(done, total, result)

    return sorted(results, key=lambda item: index_by_path.get(item.input_path, 0))
