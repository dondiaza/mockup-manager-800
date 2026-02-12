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

function getExtension(filename) {
  const index = filename.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return filename.slice(index).toLowerCase();
}

export function isSupportedFile(file) {
  return SUPPORTED_EXTENSIONS.has(getExtension(file.name));
}

export function toBaseName(filename) {
  const index = filename.lastIndexOf(".");
  return index < 0 ? filename : filename.slice(0, index);
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

function buildCanvasFromPsd(psd) {
  if (!psd || !psd.width || !psd.height) {
    throw new Error("PSD invalido: no contiene dimensiones.");
  }

  if (psd.canvas instanceof HTMLCanvasElement) {
    return psd.canvas;
  }

  const imageData = normalizeImageData(psd.imageData);
  if (imageData) {
    const canvas = makeCanvas(psd.width, psd.height);
    const context = canvas.getContext("2d");
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  throw new Error(
    "No se pudo leer la vista compuesta del PSD. Guarda el PSD con compatibilidad maxima."
  );
}

async function loadPsdAsCanvas(file) {
  const data = await file.arrayBuffer();
  const psd = readPsd(data, {
    skipLayerImageData: true,
    skipThumbnail: true
  });
  const canvas = buildCanvasFromPsd(psd);
  return {
    drawable: canvas,
    width: canvas.width,
    height: canvas.height,
    dispose: () => {}
  };
}

async function loadRasterAsBitmap(file) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image"
  });
  return {
    drawable: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    dispose: () => bitmap.close()
  };
}

async function loadDrawable(file) {
  const extension = getExtension(file.name);
  if (extension === ".psd") {
    return loadPsdAsCanvas(file);
  }
  return loadRasterAsBitmap(file);
}

function fillCanvasBackground(context, size, background) {
  if (background === "transparent") {
    context.clearRect(0, 0, size, size);
    return;
  }

  context.fillStyle = background;
  context.fillRect(0, 0, size, size);
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

export async function processToSquarePng(file, options = {}) {
  const size = options.size ?? TARGET_SIZE;
  const background = options.background ?? "transparent";

  const source = await loadDrawable(file);
  try {
    const outputCanvas = makeCanvas(size, size);
    const context = outputCanvas.getContext("2d", {
      alpha: background === "transparent"
    });
    fillCanvasBackground(context, size, background);

    const placement = computeContainPlacement(source.width, source.height, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source.drawable, placement.x, placement.y, placement.width, placement.height);

    const blob = await canvasToPngBlob(outputCanvas);
    return {
      blob,
      sourceWidth: source.width,
      sourceHeight: source.height,
      placement
    };
  } finally {
    source.dispose();
  }
}
