from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QObject, QRunnable, Signal

from .processor import ProcessResult, process_image_file


class WorkerSignals(QObject):
    started = Signal(int)
    finished = Signal(int, object)


class ImageWorker(QRunnable):
    def __init__(
        self,
        row: int,
        input_path: Path,
        output_dir: Path,
        *,
        overwrite: bool,
        safe_mode: bool,
    ) -> None:
        super().__init__()
        self.row = row
        self.input_path = input_path
        self.output_dir = output_dir
        self.overwrite = overwrite
        self.safe_mode = safe_mode
        self.signals = WorkerSignals()

    def run(self) -> None:
        self.signals.started.emit(self.row)
        try:
            result = process_image_file(
                self.input_path,
                self.output_dir,
                overwrite=self.overwrite,
                safe_mode=self.safe_mode,
            )
        except Exception as exc:
            result = ProcessResult(
                input_path=self.input_path,
                output_path=self.output_dir / f"{self.input_path.stem}_800.jpg",
                status="error",
                message=f"Error inesperado en worker: {exc}",
            )
        self.signals.finished.emit(self.row, result)
