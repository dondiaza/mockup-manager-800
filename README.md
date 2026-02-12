# Gestor de Mockups Web (PNG 800x800 + PSD + Trello)

Aplicacion web para procesar mockups en lote desde navegador:
- Carga masiva de archivos o carpeta.
- Soporte para `PSD`, `PNG`, `JPG/JPEG`, `WEBP`, `TIFF`.
- Exporta siempre a `PNG` de `800x800`.
- Sin deformar y sin recortar: usa ajuste `contain` + relleno (transparente o color).
- Vista previa, estados por archivo, progreso global y descarga en ZIP.
- Integracion con Trello para leer tableros y listas.

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
2. Opcional: ajustar `Fondo de relleno`:
   - Transparente (default)
   - Blanco
   - Negro
3. Click en `Procesar todo`.
4. Revisar estado por archivo y vista previa.
5. Descargar individual o `Descargar ZIP`.

## PSD

- Se procesa el PSD usando su vista compuesta.
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
|     |- boards.js
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
