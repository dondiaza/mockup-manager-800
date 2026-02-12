# Gestor de Mockups Web (PNG 800x800 + PSD + Trello)

Aplicacion web para procesar mockups en lote desde navegador:
- Carga masiva de archivos o carpeta.
- Soporte para `PSD`, `PNG`, `JPG/JPEG`, `WEBP`, `TIFF`.
- Exporta siempre a `PNG` de `800x800`.
- Sin deformar y sin recortar: usa ajuste `contain` + relleno inteligente.
- Vista previa, estados por archivo, progreso global y descarga en ZIP.
- Integracion con Trello para leer tableros, listas, tarjetas y extraer adjuntos.

## Requisitos

- Node.js `20+` (recomendado 20/22/24)

## Instalacion local

```bash
npm install
```

## Ejecutar en local

```bash
npm run dev
```

Abre la URL que muestra Vite (por defecto `http://localhost:5173`).

## Build de produccion

```bash
npm run build
npm run preview
```

## Pruebas

```bash
npm run test
```

Incluye 3 casos para el algoritmo `contain`:
- Imagen horizontal.
- Imagen vertical.
- Imagen cuadrada centrada.

## Flujo de uso

1. `Seleccionar archivos` o `Seleccionar carpeta` (carga masiva).
2. Opcional:
   - `Sin fondo`: elimina fondo predominante conectado en bordes.
   - `Extraer por capas (PSD)`: una salida por capa rasterizable.
   - `Fondo adicional con color predominante`: relleno automatico del color de fondo dominante.
   - `Fondo fallback`: color de respaldo cuando no detecta color predominante.
3. Click en `Procesar`.
4. Revisar estado por archivo y vista previa.
5. Descargar individual o `Descargar ZIP`.

## PSD

- Se procesa el PSD usando su vista compuesta.
- Si activas `Extraer por capas (PSD)`, genera una imagen por capa con nombre de capa.
- Si un PSD no trae composicion compatible, la app mostrara error.
- Recomendacion: guardar PSD con compatibilidad maxima.

## Trello

La app usa funciones serverless en `/api/trello/*`.

Configura variables de entorno:

```bash
TRELLO_API_KEY=tu_api_key
TRELLO_TOKEN=tu_token
```

Archivo de ejemplo: `.env.example`.

Flujo Trello en UI:
1. Seleccionar tablero.
2. Seleccionar lista.
3. Seleccionar tarjeta.
4. Ver adjuntos imagen.
5. `Extraer imagenes de tarjeta`.
6. Opcional: check `Al extraer, pasar directo por el redimensionador`.

## Deploy en Vercel

Este repo ya incluye `vercel.json` para:
- build con `npm run build`
- salida `dist`
- funciones API Node en `api/**/*.js`

Pasos:
1. Importar repo en Vercel o usar CLI.
2. Configurar `TRELLO_API_KEY` y `TRELLO_TOKEN`.
3. Deploy a produccion.

## Estructura principal

```text
.
|- api/
|  |- _trelloClient.js
|  `- trello/
|     |- attachment-file.js
|     |- boards.js
|     |- card-attachments.js
|     |- cards.js
|     `- lists.js
|- src/
|  |- lib/
|  |  |- fileUtils.js
|  |  |- imageProcessing.js
|  |  `- imageProcessing.test.js
|  |- App.jsx
|  |- main.jsx
|  `- styles.css
|- index.html
|- package.json
|- vercel.json
`- README.md
```

## Limites actuales

- El soporte PSD depende de la composicion guardada en el archivo.
- TIFF depende del soporte del navegador para decodificacion.
- Trello requiere credenciales activas via variables de entorno.
- La eliminacion de fondo es heuristica basada en color predominante de bordes.
