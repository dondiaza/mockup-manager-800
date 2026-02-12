import JSZip from "jszip";
import { TARGET_SIZE, toBaseName } from "./imageProcessing";

export function buildOutputName(originalName, registry, overwriteDuplicates) {
  const base = `${toBaseName(originalName)}_${TARGET_SIZE}`;
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

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function buildZipFromResults(results) {
  const zip = new JSZip();
  for (const item of results) {
    if (item.status === "ok" && item.outputBlob && item.outputName) {
      zip.file(item.outputName, item.outputBlob);
    }
  }
  return zip.generateAsync({ type: "blob" });
}
