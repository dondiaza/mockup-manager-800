from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QSize, Qt, QThreadPool
from PySide6.QtGui import QIcon, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QCheckBox,
    QProgressBar,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .processor import ProcessResult, collect_images_from_directory, is_supported_image
from .worker import ImageWorker


@dataclass(slots=True)
class FileRecord:
    path: Path
    status: str = "pendiente"
    message: str = ""


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Gestor de Mockups")
        self.resize(980, 640)

        self.records: list[FileRecord] = []
        self.path_to_row: dict[Path, int] = {}

        self.total_jobs = 0
        self.completed_jobs = 0
        self.success_count = 0
        self.error_count = 0
        self.skipped_count = 0
        self.processing = False

        self.thread_pool = QThreadPool.globalInstance()
        self.thread_pool.setMaxThreadCount(3)
        self._active_workers: list[ImageWorker] = []

        self.error_log_path: Path | None = None
        self._error_log_stream = None

        self._build_ui()

    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root_layout = QVBoxLayout(central)

        top_row = QHBoxLayout()
        self.select_files_btn = QPushButton("Seleccionar imagenes")
        self.select_folder_btn = QPushButton("Seleccionar carpeta")
        self.clear_btn = QPushButton("Limpiar lista")
        top_row.addWidget(self.select_files_btn)
        top_row.addWidget(self.select_folder_btn)
        top_row.addWidget(self.clear_btn)
        top_row.addStretch(1)

        output_row = QHBoxLayout()
        output_row.addWidget(QLabel("Carpeta de salida:"))
        self.output_edit = QLineEdit()
        self.output_btn = QPushButton("Elegir...")
        output_row.addWidget(self.output_edit, 1)
        output_row.addWidget(self.output_btn)

        options_row = QHBoxLayout()
        self.overwrite_cb = QCheckBox("Sobrescribir si existe")
        self.safe_mode_cb = QCheckBox("Modo super seguro (menos recorte agresivo)")
        options_row.addWidget(self.overwrite_cb)
        options_row.addWidget(self.safe_mode_cb)
        options_row.addStretch(1)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["Archivo", "Estado", "Detalle"])
        self.table.setIconSize(QSize(56, 56))
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setColumnWidth(0, 360)
        self.table.setColumnWidth(1, 120)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.verticalHeader().setDefaultSectionSize(60)

        bottom_row = QHBoxLayout()
        self.progress_label = QLabel("0/0")
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.process_btn = QPushButton("Procesar")
        bottom_row.addWidget(QLabel("Progreso:"))
        bottom_row.addWidget(self.progress_label)
        bottom_row.addWidget(self.progress_bar, 1)
        bottom_row.addWidget(self.process_btn)

        root_layout.addLayout(top_row)
        root_layout.addLayout(output_row)
        root_layout.addLayout(options_row)
        root_layout.addWidget(self.table, 1)
        root_layout.addLayout(bottom_row)

        self.select_files_btn.clicked.connect(self._select_files)
        self.select_folder_btn.clicked.connect(self._select_folder)
        self.output_btn.clicked.connect(self._select_output_dir)
        self.clear_btn.clicked.connect(self._clear_list)
        self.process_btn.clicked.connect(self._start_processing)

    def _select_files(self) -> None:
        file_filter = "Imagenes (*.png *.jpg *.jpeg *.webp *.tif *.tiff)"
        file_paths, _ = QFileDialog.getOpenFileNames(self, "Seleccionar imagenes", "", file_filter)
        if file_paths:
            self._add_files([Path(path) for path in file_paths])

    def _select_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Seleccionar carpeta de imagenes")
        if not folder:
            return

        found = collect_images_from_directory(folder, recursive=True)
        if not found:
            QMessageBox.information(
                self,
                "Sin imagenes",
                "No se encontraron archivos compatibles en la carpeta seleccionada.",
            )
            return
        self._add_files(found)

    def _select_output_dir(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Seleccionar carpeta de salida")
        if folder:
            self.output_edit.setText(folder)

    def _clear_list(self) -> None:
        if self.processing:
            QMessageBox.warning(self, "Procesando", "No puedes limpiar la lista durante el procesamiento.")
            return
        self.records.clear()
        self.path_to_row.clear()
        self.table.setRowCount(0)
        self.progress_bar.setValue(0)
        self.progress_label.setText("0/0")

    def _add_files(self, paths: list[Path]) -> None:
        added = 0
        for path in paths:
            normalized = path.resolve()
            if normalized in self.path_to_row:
                continue
            if not is_supported_image(normalized):
                continue
            if not normalized.exists():
                continue

            row = self.table.rowCount()
            self.table.insertRow(row)
            self.path_to_row[normalized] = row
            self.records.append(FileRecord(path=normalized))

            file_item = QTableWidgetItem(normalized.name)
            file_item.setToolTip(str(normalized))
            pixmap = QPixmap(str(normalized))
            if not pixmap.isNull():
                thumb = pixmap.scaled(56, 56, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                file_item.setIcon(QIcon(thumb))

            status_item = QTableWidgetItem("pendiente")
            details_item = QTableWidgetItem("")
            self.table.setItem(row, 0, file_item)
            self.table.setItem(row, 1, status_item)
            self.table.setItem(row, 2, details_item)
            added += 1

        if added > 0 and not self.output_edit.text().strip():
            default_out = self.records[0].path.parent / "salida_800"
            self.output_edit.setText(str(default_out))

    def _set_row_status(self, row: int, status: str, message: str) -> None:
        status_item = self.table.item(row, 1) or QTableWidgetItem()
        details_item = self.table.item(row, 2) or QTableWidgetItem()
        status_item.setText(status)
        details_item.setText(message)
        self.table.setItem(row, 1, status_item)
        self.table.setItem(row, 2, details_item)

    def _set_controls_enabled(self, enabled: bool) -> None:
        self.select_files_btn.setEnabled(enabled)
        self.select_folder_btn.setEnabled(enabled)
        self.output_btn.setEnabled(enabled)
        self.clear_btn.setEnabled(enabled)
        self.process_btn.setEnabled(enabled)
        self.overwrite_cb.setEnabled(enabled)
        self.safe_mode_cb.setEnabled(enabled)

    def _start_processing(self) -> None:
        if self.processing:
            return
        if not self.records:
            QMessageBox.warning(self, "Lista vacia", "Agrega al menos una imagen antes de procesar.")
            return

        output_text = self.output_edit.text().strip()
        if not output_text:
            QMessageBox.warning(self, "Salida requerida", "Selecciona una carpeta de salida.")
            return

        output_dir = Path(output_text)
        output_dir.mkdir(parents=True, exist_ok=True)

        self.processing = True
        self._set_controls_enabled(False)
        self._active_workers.clear()
        self._close_error_log()
        self.error_log_path = output_dir / f"mockup_errors_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

        self.total_jobs = len(self.records)
        self.completed_jobs = 0
        self.success_count = 0
        self.error_count = 0
        self.skipped_count = 0
        self.progress_bar.setValue(0)
        self.progress_label.setText(f"0/{self.total_jobs}")

        overwrite = self.overwrite_cb.isChecked()
        safe_mode = self.safe_mode_cb.isChecked()

        for row, record in enumerate(self.records):
            record.status = "pendiente"
            record.message = ""
            self._set_row_status(row, "pendiente", "")

            worker = ImageWorker(
                row=row,
                input_path=record.path,
                output_dir=output_dir,
                overwrite=overwrite,
                safe_mode=safe_mode,
            )
            worker.signals.started.connect(self._on_worker_started)
            worker.signals.finished.connect(self._on_worker_finished)
            self._active_workers.append(worker)
            self.thread_pool.start(worker)

    def _on_worker_started(self, row: int) -> None:
        self._set_row_status(row, "procesando", "Trabajando...")

    def _on_worker_finished(self, row: int, result: ProcessResult) -> None:
        if result.status == "ok":
            status_text = "ok"
            self.success_count += 1
        elif result.status == "skipped":
            status_text = "ok"
            self.skipped_count += 1
        else:
            status_text = "error"
            self.error_count += 1
            self._write_error_log(result)

        self.records[row].status = status_text
        self.records[row].message = result.message
        self._set_row_status(row, status_text, result.message)

        self.completed_jobs += 1
        percentage = int((self.completed_jobs / max(1, self.total_jobs)) * 100)
        self.progress_bar.setValue(percentage)
        self.progress_label.setText(f"{self.completed_jobs}/{self.total_jobs}")

        if self.completed_jobs >= self.total_jobs:
            self._finish_processing()

    def _write_error_log(self, result: ProcessResult) -> None:
        if self._error_log_stream is None and self.error_log_path is not None:
            self._error_log_stream = self.error_log_path.open("w", encoding="utf-8")
            self._error_log_stream.write("archivo,error\n")
        if self._error_log_stream is not None:
            error_text = result.message.replace("\n", " ").replace(",", ";")
            self._error_log_stream.write(f"{result.input_path},{error_text}\n")
            self._error_log_stream.flush()

    def _close_error_log(self) -> None:
        if self._error_log_stream is not None:
            self._error_log_stream.close()
            self._error_log_stream = None

    def _finish_processing(self) -> None:
        self.processing = False
        self._set_controls_enabled(True)
        self._active_workers.clear()
        self._close_error_log()

        summary = (
            f"Completado.\n\n"
            f"OK: {self.success_count}\n"
            f"Omitidos: {self.skipped_count}\n"
            f"Errores: {self.error_count}"
        )
        if self.error_count > 0 and self.error_log_path:
            summary += f"\n\nLog de errores:\n{self.error_log_path}"
        QMessageBox.information(self, "Resumen", summary)


def run() -> int:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()
