import JSZip from "jszip";
import { TARGET_SIZE, toBaseName } from "./imageProcessing";

function nextName(base, registry, overwriteDuplicates) {
  const firstName = `${base}.png`;
  if (overwriteDuplicates) {
    registry.set(firstName, 1);
    return firstName;
  }

  if (!registry.has(firstName)) {
    registry.set(firstName, 1);
    return firstName;
  }

  const nextIndex = registry.get(firstName) + 1;
  registry.set(firstName, nextIndex);
  return `${base}_${nextIndex}.png`;
}

export function sanitizeStem(stem) {
  return (stem || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^_+|_+$/g, "") || "archivo";
}

export function buildOutputName(originalName, registry, overwriteDuplicates) {
  const base = `${sanitizeStem(toBaseName(originalName))}_${TARGET_SIZE}`;
  return nextName(base, registry, overwriteDuplicates);
}

export function buildOutputNameFromStem(stem, registry, overwriteDuplicates) {
  const base = `${sanitizeStem(stem)}_${TARGET_SIZE}`;
  return nextName(base, registry, overwriteDuplicates);
}

export function buildOutputNameFromStemRealSize(stem, registry, overwriteDuplicates) {
  const base = `${sanitizeStem(stem)}_real`;
  return nextName(base, registry, overwriteDuplicates);
}

export function makeLayerStem(fileName, layerName) {
  return `${sanitizeStem(toBaseName(fileName))}_${sanitizeStem(layerName)}`;
}

export function makeAttachmentStem(cardName, attachmentName, index = 0) {
  const card = sanitizeStem(cardName || "trello_card");
  const attachment = sanitizeStem((attachmentName || `attachment_${index + 1}`).replace(/\.[^.]+$/, ""));
  return `${card}__${attachment}`;
}

export function isRenderableAttachment(attachment) {
  const mime = attachment?.mimeType || "";
  const name = attachment?.name || "";
  return mime.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|psd)$/i.test(name);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createOutput(name, blob) {
  return {
    name,
    blob,
    url: URL.createObjectURL(blob)
  };
}

export function clearOutputs(item) {
  for (const output of item.outputs || []) {
    if (output?.url) {
      URL.revokeObjectURL(output.url);
    }
  }
  item.outputs = [];
}

export function releaseItemResources(item) {
  if (item.inputUrl) {
    URL.revokeObjectURL(item.inputUrl);
  }
  clearOutputs(item);
}

export function flattenOutputs(items) {
  const list = [];
  for (const item of items) {
    for (const output of item.outputs || []) {
      if (output?.name && output?.blob) {
        list.push(output);
      }
    }
  }
  return list;
}

async function buildZipFromOutputs(outputs) {
  const zip = new JSZip();
  for (const output of outputs) {
    zip.file(output.name, output.blob);
  }
  return zip.generateAsync({ type: "blob" });
}

export async function buildZipFromItems(items) {
  return buildZipFromOutputs(flattenOutputs(items));
}

export async function buildZipForItem(item) {
  return buildZipFromOutputs(item.outputs || []);
}

export function outputLabel(item) {
  if (!item.outputs || item.outputs.length === 0) {
    return "-";
  }
  if (item.outputs.length === 1) {
    return item.outputs[0].name;
  }
  return `${item.outputs.length} salidas`;
}

export function previewUrl(item) {
  if (item.outputs && item.outputs.length > 0 && item.outputs[0].url) {
    return item.outputs[0].url;
  }
  return item.inputUrl || "";
}
