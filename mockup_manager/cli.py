from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from .processor import collect_images_from_directory, process_batch


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mockup-cli",
        description="Procesador de mockups en lote a JPG 800x800.",
    )
    parser.add_argument("--input-dir", required=True, help="Carpeta con imagenes de entrada.")
    parser.add_argument("--output-dir", required=True, help="Carpeta donde se guardaran los JPG.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Sobrescribir archivos de salida existentes.",
    )
    parser.add_argument(
        "--safe-mode",
        action="store_true",
        help="Modo super seguro: menos recorte agresivo y mas sesgo al centro.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="Cantidad de workers paralelos (recomendado 2-4).",
    )
    parser.add_argument(
        "--non-recursive",
        action="store_true",
        help="Procesar solo archivos de la carpeta raiz (sin subcarpetas).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists() or not input_dir.is_dir():
        print(f"[ERROR] Carpeta de entrada invalida: {input_dir}")
        return 2

    files = collect_images_from_directory(input_dir, recursive=not args.non_recursive)
    if not files:
        print("[INFO] No se encontraron imagenes compatibles para procesar.")
        return 1

    print(f"[INFO] Procesando {len(files)} imagen(es)...")

    def on_progress(done: int, total: int, result) -> None:
        print(f"[{done}/{total}] {result.input_path.name} -> {result.status}: {result.message}")

    results = process_batch(
        files,
        output_dir,
        overwrite=args.overwrite,
        safe_mode=args.safe_mode,
        workers=max(1, min(args.workers, 8)),
        progress_callback=on_progress,
    )

    ok_count = sum(1 for item in results if item.status == "ok")
    skipped_count = sum(1 for item in results if item.status == "skipped")
    error_results = [item for item in results if item.status == "error"]

    if error_results:
        log_path = output_dir / f"mockup_errors_cli_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        with log_path.open("w", encoding="utf-8") as stream:
            stream.write("archivo,error\n")
            for item in error_results:
                error_text = item.message.replace("\n", " ").replace(",", ";")
                stream.write(f"{item.input_path},{error_text}\n")
        print(f"[INFO] Log de errores: {log_path}")

    print(
        f"[RESUMEN] OK={ok_count} | Omitidos={skipped_count} | "
        f"Errores={len(error_results)} | Total={len(results)}"
    )
    return 0 if not error_results else 1


if __name__ == "__main__":
    raise SystemExit(main())
