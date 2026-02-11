# Gestor de Mockups (Batch 800x800)

App de escritorio para procesar mockups por lote:
- Carga multiples imagenes o una carpeta completa.
- Aplica recorte inteligente 1:1 sin deformar.
- Exporta JPG `800x800`, `quality=100`, `subsampling=4:4:4`.
- Muestra estado por archivo, progreso global y resumen final.
- Incluye CLI y pruebas automaticas.

## Caracteristicas

- Formatos de entrada: `PNG`, `JPG/JPEG`, `WEBP`, `TIFF`.
- Correccion automatica de orientacion EXIF.
- Conversion a `RGB` y composicion sobre blanco cuando hay alpha.
- Smart crop por mapa de energia visual (bordes + contraste).
- Fallback seguro al recorte centrado cuando el smart crop falla.
- Exportacion consistente con sufijo `_800`:
  - `mockup01.png` -> `mockup01_800.jpg`
- Modo super seguro opcional (menos recorte agresivo).
- Procesamiento en workers (UI no se congela, concurrencia limitada).
- Log de errores por ejecucion.

## Estructura

```text
.
|- main.py
|- requirements.txt
|- README.md
|- mockup_manager/
|  |- __init__.py
|  |- __main__.py
|  |- app.py
|  |- cli.py
|  |- processor.py
|  |- ui.py
|  `- worker.py
|- scripts/
|  `- process_folder.py
`- tests/
   `- test_processor.py
```

## Requisitos

- Python `3.10+`
- Dependencias:
  - `Pillow`
  - `PySide6`
  - `numpy`
  - `pytest` (solo para tests)

## Instalacion

### Windows (PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Si `PySide6` falla al instalarse por rutas largas en Windows, habilita `Long Paths` y vuelve a instalar.

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Uso de la app (UI)

```bash
python main.py
```

Flujo:
1. Click en `Seleccionar imagenes` o `Seleccionar carpeta`.
2. Elige `Carpeta de salida`.
3. Configura:
   - `Sobrescribir si existe`
   - `Modo super seguro`
4. Click en `Procesar`.
5. Revisa estados (`pendiente / procesando / ok / error`) y barra global.

## Uso por terminal (CLI)

```bash
python scripts/process_folder.py --input-dir "ruta/entrada" --output-dir "ruta/salida"
```

Opciones:
- `--overwrite`: sobrescribe si ya existe.
- `--safe-mode`: menos agresivo al recortar.
- `--workers 3`: numero de workers (recomendado 2-4).
- `--non-recursive`: no entrar en subcarpetas.

Ejemplo:

```bash
python scripts/process_folder.py --input-dir ./in --output-dir ./out --overwrite --safe-mode --workers 3
```

## Pruebas

```bash
pytest -q
```

Los tests cubren al menos 3 casos:
- Imagen horizontal.
- Imagen vertical.
- Imagen con sujeto centrado.

Ademas validan que cada salida sea exactamente `800x800`.

## Como funciona el smart crop

1. Se genera un mapa de energia (gradiente + contraste local).
2. Se estima una region saliente (bounding box relevante).
3. Se evaluan candidatos de recorte cuadrado 1:1 y se puntuan por:
   - energia visual,
   - cobertura del bounding box saliente,
   - cercania al foco y al centro.
4. Se aplica el mejor recorte.
5. Si falla, se usa recorte centrado como fallback.

## Limitaciones actuales

- No incluye deteccion explicita de caras (OpenCV) por mantener dependencias ligeras.
- En imagenes extremadamente uniformes, el recorte tiende al centro (fallback seguro).
- Si distintos archivos comparten el mismo nombre base, produciran el mismo nombre de salida en la misma carpeta.

## Consejos para mejorar el smart crop

- Anadir detector de caras y sumar peso a regiones faciales.
- Anadir detector de texto/logotipo para mockups de producto.
- Permitir ajuste fino de pesos de energia/centro desde la UI.
- Implementar un modo opcional con padding (letterbox) para casos extremos.
