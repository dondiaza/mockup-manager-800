import { readPsd } from "ag-psd";

export const TARGET_SIZE = 800;
export const SUPPORTED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
  ".psd"
]);

function isCanvasLike(value) {
  return Boolean(
    value &&
      typeof value.width === "number" &&
      typeof value.height === "number" &&
      typeof value.getContext === "function"
  );
}

export function getExtension(filename) {
  const index = filename.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return filename.slice(index).toLowerCase();
}

export function isSupportedFile(file) {
  return SUPPORTED_EXTENSIONS.has(getExtension(file.name));
}

export function isPsdFile(file) {
  return getExtension(file.name) === ".psd";
}

export function toBaseName(filename) {
  const index = filename.lastIndexOf(".");
  return index < 0 ? filename : filename.slice(0, index);
}

export function sanitizeLayerName(name, fallbackIndex) {
  const raw = (name || "").trim();
  const base = raw || `layer_${fallbackIndex + 1}`;
  const safe = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^_+|_+$/g, "");
  return safe || `layer_${fallbackIndex + 1}`;
}

export function computeContainPlacement(sourceWidth, sourceHeight, size) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || size <= 0) {
    throw new Error("Dimensiones invalidas para la conversion.");
  }

  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (size - width) / 2;
  const y = (size - height) / 2;

  return {
    x,
    y,
    width,
    height,
    scale
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function normalizeImageData(imageData) {
  if (!imageData || !imageData.data) {
    return null;
  }

  if (imageData.data instanceof Uint8ClampedArray) {
    return new ImageData(imageData.data, imageData.width, imageData.height);
  }

  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function buildCanvasFromImageData(imageData) {
  const normalized = normalizeImageData(imageData);
  if (!normalized) {
    return null;
  }
  const canvas = makeCanvas(normalized.width, normalized.height);
  const context = canvas.getContext("2d");
  context.putImageData(normalized, 0, 0);
  return canvas;
}

function buildCanvasFromPsd(psd) {
  if (!psd || !psd.width || !psd.height) {
    throw new Error("PSD invalido: no contiene dimensiones.");
  }

  if (isCanvasLike(psd.canvas)) {
    return psd.canvas;
  }

  const canvasFromData = buildCanvasFromImageData(psd.imageData);
  if (canvasFromData) {
    return canvasFromData;
  }

  throw new Error(
    "No se pudo leer la vista compuesta del PSD. Guarda el PSD con compatibilidad maxima."
  );
}

function buildLayerCanvas(layer) {
  if (isCanvasLike(layer?.canvas)) {
    return layer.canvas;
  }
  return buildCanvasFromImageData(layer?.imageData);
}

function colorDistanceSquared(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (dr * dr) + (dg * dg) + (db * db);
}

function detectDominantBorderColor(canvas) {
  if (!isCanvasLike(canvas) || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 240));

  const bins = new Map();
  const bucket = 24;

  function addPixel(x, y) {
    const offset = ((y * width) + x) * 4;
    const alpha = data[offset + 3];
    if (alpha < 18) {
      return;
    }
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const key = `${Math.floor(r / bucket)}|${Math.floor(g / bucket)}|${Math.floor(b / bucket)}`;
    const current = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    current.count += 1;
    current.r += r;
    current.g += g;
    current.b += b;
    bins.set(key, current);
  }

  for (let x = 0; x < width; x += step) {
    addPixel(x, 0);
    addPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    addPixel(0, y);
    addPixel(width - 1, y);
  }

  let best = null;
  for (const entry of bins.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  if (!best || best.count <= 0) {
    return null;
  }

  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count)
  };
}

function toHexColor(color) {
  if (!color) {
    return null;
  }
  return `#${[color.r, color.g, color.b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function removeConnectedBackground(canvas, color, tolerance = 40) {
  if (!color || !isCanvasLike(canvas)) {
    return;
  }
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const visited = new Uint8Array(width * height);
  const queue = [];
  const threshold = tolerance * tolerance;

  function canRemove(index) {
    if (visited[index]) {
      return false;
    }
    const offset = index * 4;
    const alpha = pixels[offset + 3];
    if (alpha < 18) {
      return false;
    }
    const distance = colorDistanceSquared(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      color.r,
      color.g,
      color.b
    );
    return distance <= threshold;
  }

  function seed(x, y) {
    const index = (y * width) + x;
    if (canRemove(index)) {
      visited[index] = 1;
      queue.push(index);
    }
  }

  for (let x = 0; x < width; x += 1) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    seed(0, y);
    seed(width - 1, y);
  }

  let pointer = 0;
  while (pointer < queue.length) {
    const index = queue[pointer];
    pointer += 1;
    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) {
      seed(x - 1, y);
    }
    if (x < width - 1) {
      seed(x + 1, y);
    }
    if (y > 0) {
      seed(x, y - 1);
    }
    if (y < height - 1) {
      seed(x, y + 1);
    }
  }

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) {
      pixels[(index * 4) + 3] = 0;
    }
  }

  context.putImageData(imageData, 0, 0);
}

async function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo generar el PNG de salida."));
          return;
        }
        resolve(blob);
      },
      "image/png",
      1
    );
  });
}

function fillOutputBackground(context, size, background) {
  if (background === "transparent") {
    context.clearRect(0, 0, size, size);
    return;
  }
  context.fillStyle = background;
  context.fillRect(0, 0, size, size);
}

async function loadRasterAsCanvas(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function loadPsdCompositeCanvas(file) {
  const data = await file.arrayBuffer();
  const psd = readPsd(data, {
    skipLayerImageData: true,
    skipThumbnail: true
  });
  return buildCanvasFromPsd(psd);
}

async function loadSourceCanvas(file) {
  if (isPsdFile(file)) {
    return loadPsdCompositeCanvas(file);
  }
  return loadRasterAsCanvas(file);
}

async function renderCanvasToSquare(sourceCanvas, options = {}) {
  const size = options.size ?? TARGET_SIZE;
  const removeBackground = Boolean(options.removeBackground);
  const generateBackground = Boolean(options.generateBackground);
  const fallbackBackground = options.background ?? "#ffffff";
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;

  const dominantColor = detectDominantBorderColor(sourceCanvas);
  const dominantHex = toHexColor(dominantColor);
  const outputBackground = removeBackground
    ? "transparent"
    : ((generateBackground && dominantHex) || fallbackBackground);

  const outputCanvas = makeCanvas(size, size);
  const context = outputCanvas.getContext("2d", {
    alpha: outputBackground === "transparent"
  });
  fillOutputBackground(context, size, outputBackground);

  const placement = computeContainPlacement(sourceWidth, sourceHeight, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, placement.x, placement.y, placement.width, placement.height);

  if (removeBackground && dominantColor) {
    removeConnectedBackground(outputCanvas, dominantColor, options.backgroundTolerance ?? 42);
  }

  const blob = await canvasToPngBlob(outputCanvas);
  return {
    blob,
    sourceWidth,
    sourceHeight,
    placement,
    dominantBackground: dominantHex || ""
  };
}

function collectPsdLayers(psd) {
  const list = [];

  function walkLayers(layers, prefix = []) {
    if (!Array.isArray(layers)) {
      return;
    }
    layers.forEach((layer, index) => {
      const layerName = sanitizeLayerName(layer?.name, index);
      const groupPath = [...prefix, layerName];

      if (Array.isArray(layer?.children) && layer.children.length > 0) {
        walkLayers(layer.children, groupPath);
        return;
      }

      const layerCanvas = buildLayerCanvas(layer);
      if (!layerCanvas || layerCanvas.width <= 0 || layerCanvas.height <= 0) {
        return;
      }

      const left = Number.isFinite(layer?.left) ? layer.left : 0;
      const top = Number.isFinite(layer?.top) ? layer.top : 0;
      const documentCanvas = makeCanvas(psd.width, psd.height);
      const context = documentCanvas.getContext("2d");
      context.clearRect(0, 0, psd.width, psd.height);
      context.drawImage(layerCanvas, left, top);

      list.push({
        name: groupPath.join("__"),
        canvas: documentCanvas
      });
    });
  }

  walkLayers(psd.children || []);
  return list;
}

export async function processToSquarePng(file, options = {}) {
  const sourceCanvas = await loadSourceCanvas(file);
  return renderCanvasToSquare(sourceCanvas, options);
}

export async function extractPsdLayersToSquarePng(file, options = {}) {
  if (!isPsdFile(file)) {
    throw new Error("La extraccion por capas solo aplica a archivos PSD.");
  }

  const data = await file.arrayBuffer();
  const psd = readPsd(data, {
    skipCompositeImageData: true,
    skipThumbnail: true
  });
  if (!psd || !psd.width || !psd.height) {
    throw new Error("No se pudo leer el PSD.");
  }

  const layers = collectPsdLayers(psd);
  if (layers.length === 0) {
    throw new Error("El PSD no tiene capas rasterizables para extraer.");
  }

  const results = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const rendered = await renderCanvasToSquare(layer.canvas, options);
    results.push({
      ...rendered,
      layerName: layer.name,
      layerIndex: index
    });
  }
  return results;
}
