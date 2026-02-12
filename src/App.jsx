import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildOutputName,
  buildOutputNameFromStem,
  buildOutputNameFromStemRealSize,
  buildZipForItem,
  buildZipFromItems,
  clearOutputs,
  createOutput,
  downloadBlob,
  isRenderableAttachment,
  makeAttachmentStem,
  makeLayerStem,
  outputLabel,
  previewUrl,
  releaseItemResources,
  sanitizeStem
} from "./lib/fileUtils";
import {
  extractPsdLayersToSquarePng,
  isPsdFile,
  isSupportedFile,
  processToSquarePng
} from "./lib/imageProcessing";

function createItem(file) {
  return {
    id: `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
    fingerprint: `${file.name}-${file.lastModified}-${file.size}`,
    file,
    inputUrl: URL.createObjectURL(file),
    status: "pendiente",
    message: "",
    outputs: [],
    sourceWidth: 0,
    sourceHeight: 0
  };
}

function fileExtensionFromName(name) {
  const index = (name || "").lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return name.slice(index).toLowerCase();
}

function extensionFromMimeType(mimeType) {
  if (!mimeType) {
    return ".png";
  }
  if (mimeType.includes("jpeg")) {
    return ".jpg";
  }
  if (mimeType.includes("webp")) {
    return ".webp";
  }
  if (mimeType.includes("tiff")) {
    return ".tiff";
  }
  if (mimeType.includes("psd")) {
    return ".psd";
  }
  return ".png";
}

function ensureAttachmentFileName(cardName, attachmentName, mimeType, index) {
  const stem = makeAttachmentStem(cardName, attachmentName, index);
  const ext = fileExtensionFromName(attachmentName) || extensionFromMimeType(mimeType);
  return `${stem}${ext}`;
}

export default function App() {
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);

  const [processing, setProcessing] = useState(false);
  const [overwriteDuplicates, setOverwriteDuplicates] = useState(true);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [extractPsdLayers, setExtractPsdLayers] = useState(false);
  const [exportPsdLayersRealSize, setExportPsdLayersRealSize] = useState(false);
  const [generateDominantBackground, setGenerateDominantBackground] = useState(true);
  const [fallbackBackground, setFallbackBackground] = useState("#ffffff");
  const [selectedId, setSelectedId] = useState("");
  const [globalMessage, setGlobalMessage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [trelloLoading, setTrelloLoading] = useState(false);
  const [trelloError, setTrelloError] = useState("");
  const [boards, setBoards] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState("");
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState("");
  const [cards, setCards] = useState([]);
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [importingAttachments, setImportingAttachments] = useState(false);
  const [autoResizeTrelloImport, setAutoResizeTrelloImport] = useState(true);

  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        releaseItemResources(item);
      }
    };
  }, []);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const okCount = useMemo(() => items.filter((item) => item.status === "ok").length, [items]);
  const errorCount = useMemo(() => items.filter((item) => item.status === "error").length, [items]);
  const outputCount = useMemo(
    () => items.reduce((accumulator, item) => accumulator + (item.outputs?.length || 0), 0),
    [items]
  );

  function appendFiles(fileList, explicitBaseItems = null) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) {
      return { addedItems: [], mergedItems: explicitBaseItems || itemsRef.current };
    }

    const baseItems = explicitBaseItems || itemsRef.current;
    const supported = incoming.filter(isSupportedFile);
    const unsupportedCount = incoming.length - supported.length;
    const fingerprints = new Set(baseItems.map((item) => item.fingerprint));

    const newItems = [];
    for (const file of supported) {
      const fingerprint = `${file.name}-${file.lastModified}-${file.size}`;
      if (fingerprints.has(fingerprint)) {
        continue;
      }
      fingerprints.add(fingerprint);
      newItems.push(createItem(file));
    }

    const mergedItems = [...baseItems, ...newItems];
    setItems(mergedItems);
    itemsRef.current = mergedItems;

    if (!selectedId && newItems.length > 0) {
      setSelectedId(newItems[0].id);
    }

    if (unsupportedCount > 0) {
      setGlobalMessage(
        `Se omitieron ${unsupportedCount} archivo(s) no soportado(s). Soportados: PNG/JPG/WEBP/TIFF/PSD.`
      );
    } else if (newItems.length > 0) {
      setGlobalMessage(`Se agregaron ${newItems.length} archivo(s).`);
    }

    return {
      addedItems: newItems,
      mergedItems
    };
  }

  function processingOptions() {
    return {
      size: 800,
      removeBackground,
      generateBackground: !removeBackground && generateDominantBackground,
      background: fallbackBackground,
      backgroundTolerance: 42
    };
  }

  async function processItemOutputs(file, registry) {
    const options = processingOptions();
    if (extractPsdLayers && isPsdFile(file)) {
      const layerResults = await extractPsdLayersToSquarePng(file, {
        ...options,
        realSize: exportPsdLayersRealSize
      });
      const outputs = [];
      for (const layerResult of layerResults) {
        const entityName = layerResult.kind === "artboard"
          ? `artboard_${layerResult.layerName}`
          : layerResult.layerName;
        const stem = makeLayerStem(file.name, entityName);
        const outputName = layerResult.realSize
          ? buildOutputNameFromStemRealSize(stem, registry, overwriteDuplicates)
          : buildOutputNameFromStem(stem, registry, overwriteDuplicates);
        outputs.push(createOutput(outputName, layerResult.blob));
      }
      return {
        outputs,
        sourceWidth: layerResults[0]?.sourceWidth || 0,
        sourceHeight: layerResults[0]?.sourceHeight || 0
      };
    }

    const single = await processToSquarePng(file, options);
    const outputName = buildOutputName(file.name, registry, overwriteDuplicates);
    return {
      outputs: [createOutput(outputName, single.blob)],
      sourceWidth: single.sourceWidth,
      sourceHeight: single.sourceHeight
    };
  }

  async function runProcessing(targetIds = null, explicitBaseItems = null) {
    if (processing) {
      return;
    }

    const base = explicitBaseItems || itemsRef.current;
    if (!base.length) {
      setGlobalMessage("No hay archivos para procesar.");
      return;
    }

    const working = base.map((item) => ({
      ...item,
      outputs: [...(item.outputs || [])]
    }));

    const targetSet = targetIds ? new Set(targetIds) : null;
    const targetIndexes = [];
    working.forEach((item, index) => {
      if (!targetSet || targetSet.has(item.id)) {
        targetIndexes.push(index);
      }
    });

    if (targetIndexes.length === 0) {
      setGlobalMessage("No hay elementos coincidentes para procesar.");
      return;
    }

    const registry = new Map();
    if (!overwriteDuplicates) {
      working.forEach((item, index) => {
        if (targetIndexes.includes(index)) {
          return;
        }
        for (const output of item.outputs || []) {
          registry.set(output.name, 1);
        }
      });
    }

    setProcessing(true);
    setGlobalMessage("");
    setProgress({ done: 0, total: targetIndexes.length });
    setItems(working);
    itemsRef.current = working;

    for (let progressIndex = 0; progressIndex < targetIndexes.length; progressIndex += 1) {
      const itemIndex = targetIndexes[progressIndex];
      const current = working[itemIndex];
      clearOutputs(current);
      current.status = "procesando";
      current.message = "Procesando...";
      setItems([...working]);
      itemsRef.current = [...working];

      try {
        const processed = await processItemOutputs(current.file, registry);
        current.outputs = processed.outputs;
        current.sourceWidth = processed.sourceWidth;
        current.sourceHeight = processed.sourceHeight;
        current.status = "ok";
        current.message = current.outputs.length === 1 ? "1 salida generada." : `${current.outputs.length} salidas generadas.`;
      } catch (error) {
        clearOutputs(current);
        current.status = "error";
        current.message = error instanceof Error ? error.message : "Error inesperado durante el proceso.";
      }

      setProgress({ done: progressIndex + 1, total: targetIndexes.length });
      setItems([...working]);
      itemsRef.current = [...working];
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setProcessing(false);
    setGlobalMessage("Proceso completado.");
  }

  async function handleDownloadZip() {
    const processedItems = items.filter((item) => item.status === "ok" && (item.outputs?.length || 0) > 0);
    if (processedItems.length === 0) {
      setGlobalMessage("No hay salidas procesadas para descargar.");
      return;
    }
    setGlobalMessage("Construyendo ZIP...");
    const zipBlob = await buildZipFromItems(processedItems);
    downloadBlob(zipBlob, "mockups_800_png.zip");
    setGlobalMessage("ZIP descargado.");
  }

  async function handleDownloadItem(item) {
    if (!item.outputs || item.outputs.length === 0) {
      return;
    }
    if (item.outputs.length === 1) {
      const single = item.outputs[0];
      downloadBlob(single.blob, single.name);
      return;
    }

    const zipBlob = await buildZipForItem(item);
    const safeName = sanitizeStem(item.file.name.replace(/\.[^.]+$/, ""));
    downloadBlob(zipBlob, `${safeName}_capas_800.zip`);
  }

  function handleClear() {
    if (processing || importingAttachments) {
      return;
    }
    for (const item of itemsRef.current) {
      releaseItemResources(item);
    }
    setItems([]);
    itemsRef.current = [];
    setSelectedId("");
    setProgress({ done: 0, total: 0 });
    setGlobalMessage("");
  }

  async function loadBoards() {
    setTrelloLoading(true);
    setTrelloError("");
    setBoards([]);
    setLists([]);
    setCards([]);
    setAttachments([]);
    setSelectedBoard("");
    setSelectedList("");
    setSelectedCardIds([]);
    try {
      const response = await fetch("/api/trello/boards");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "No se pudo leer Trello.");
      }
      setBoards(data.boards || []);
    } catch (error) {
      setTrelloError(error instanceof Error ? error.message : "Error cargando tableros.");
    } finally {
      setTrelloLoading(false);
    }
  }

  async function loadLists(boardId) {
    setSelectedBoard(boardId);
    setSelectedList("");
    setSelectedCardIds([]);
    setLists([]);
    setCards([]);
    setAttachments([]);
    if (!boardId) {
      return;
    }
    setTrelloLoading(true);
    setTrelloError("");
    try {
      const response = await fetch(`/api/trello/lists?boardId=${encodeURIComponent(boardId)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "No se pudieron leer las listas.");
      }
      setLists(data.lists || []);
    } catch (error) {
      setTrelloError(error instanceof Error ? error.message : "Error cargando listas.");
    } finally {
      setTrelloLoading(false);
    }
  }

  async function loadCards(listId) {
    setSelectedList(listId);
    setSelectedCardIds([]);
    setCards([]);
    setAttachments([]);
    if (!listId) {
      return;
    }
    setTrelloLoading(true);
    setTrelloError("");
    try {
      const response = await fetch(`/api/trello/cards?listId=${encodeURIComponent(listId)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "No se pudieron leer las tarjetas.");
      }
      setCards(data.cards || []);
    } catch (error) {
      setTrelloError(error instanceof Error ? error.message : "Error cargando tarjetas.");
    } finally {
      setTrelloLoading(false);
    }
  }

  function toggleCardSelection(cardId) {
    setSelectedCardIds((current) => {
      if (current.includes(cardId)) {
        return current.filter((id) => id !== cardId);
      }
      return [...current, cardId];
    });
    setAttachments([]);
  }

  function selectAllCards() {
    setSelectedCardIds(cards.map((card) => card.id));
    setAttachments([]);
  }

  function clearCardSelection() {
    setSelectedCardIds([]);
    setAttachments([]);
  }

  async function fetchRenderableAttachments(cardId) {
    const response = await fetch(`/api/trello/card-attachments?cardId=${encodeURIComponent(cardId)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "No se pudieron leer los adjuntos de una tarjeta.");
    }
    return (data.attachments || []).filter(isRenderableAttachment);
  }

  async function importCardImages() {
    if (selectedCardIds.length === 0) {
      setGlobalMessage("Selecciona al menos una tarjeta para extraer imagenes.");
      return;
    }
    setImportingAttachments(true);
    setTrelloError("");
    try {
      const cardsById = new Map(cards.map((card) => [card.id, card]));
      const files = [];
      const aggregatedAttachments = [];
      let totalAttachments = 0;
      let cardsWithImages = 0;

      for (const cardId of selectedCardIds) {
        const selectedAttachments = await fetchRenderableAttachments(cardId);
        totalAttachments += selectedAttachments.length;
        if (selectedAttachments.length > 0) {
          cardsWithImages += 1;
        }

        const selectedCardData = cardsById.get(cardId);
        const cardName = selectedCardData?.name || "trello_card";
        aggregatedAttachments.push(
          ...selectedAttachments.map((attachment) => ({
            ...attachment,
            cardId,
            cardName
          }))
        );

        for (let index = 0; index < selectedAttachments.length; index += 1) {
          const attachment = selectedAttachments[index];
          const fileResponse = await fetch(
            `/api/trello/attachment-file?cardId=${encodeURIComponent(cardId)}&attachmentId=${encodeURIComponent(attachment.id)}`
          );
          if (!fileResponse.ok) {
            let message = "No se pudo descargar un adjunto.";
            try {
              const payload = await fileResponse.json();
              message = payload.error || message;
            } catch {
              message = `${message} Estado ${fileResponse.status}.`;
            }
            throw new Error(message);
          }
          const blob = await fileResponse.blob();
          const fileName = ensureAttachmentFileName(cardName, attachment.name, blob.type || attachment.mimeType, index);
          files.push(
            new File(
              [blob],
              fileName,
              {
                type: blob.type || attachment.mimeType || "image/png",
                lastModified: Date.now()
              }
            )
          );
        }
      }
      setAttachments(aggregatedAttachments);

      if (!files.length) {
        throw new Error("Las tarjetas seleccionadas no tienen imagenes adjuntas.");
      }

      const { addedItems, mergedItems } = appendFiles(files);
      if (!addedItems.length) {
        setGlobalMessage("No se agregaron nuevas imagenes desde Trello (posibles duplicados).");
      } else {
        setGlobalMessage(
          `Se importaron ${addedItems.length} imagen(es) desde ${cardsWithImages}/${selectedCardIds.length} tarjeta(s). Total adjuntos: ${totalAttachments}.`
        );
      }

      if (autoResizeTrelloImport && addedItems.length > 0) {
        await runProcessing(new Set(addedItems.map((item) => item.id)), mergedItems);
      }
    } catch (error) {
      setTrelloError(error instanceof Error ? error.message : "Error importando imagenes de Trello.");
    } finally {
      setImportingAttachments(false);
    }
  }

  return (
    <main className="layout">
      <header className="hero">
        <h1>Gestor de Mockups Web</h1>
        <p>PSD/PNG/JPG/WEBP/TIFF a PNG 800x800, en lote, sin deformar.</p>
      </header>

      <section className="panel controls">
        <div className="actions">
          <button type="button" onClick={() => filesInputRef.current?.click()} disabled={processing || importingAttachments}>
            Seleccionar archivos
          </button>
          <button type="button" onClick={() => folderInputRef.current?.click()} disabled={processing || importingAttachments}>
            Seleccionar carpeta
          </button>
          <button type="button" onClick={() => runProcessing()} disabled={processing || importingAttachments || items.length === 0}>
            {processing ? "Procesando..." : "Procesar"}
          </button>
          <button type="button" onClick={handleDownloadZip} disabled={processing || importingAttachments || outputCount === 0}>
            Descargar ZIP
          </button>
          <button type="button" className="ghost" onClick={handleClear} disabled={processing || importingAttachments}>
            Limpiar
          </button>
        </div>

        <div className="options">
          <label>
            <input
              type="checkbox"
              checked={overwriteDuplicates}
              onChange={(event) => setOverwriteDuplicates(event.target.checked)}
              disabled={processing || importingAttachments}
            />
            Sobrescribir nombres duplicados
          </label>

          <label>
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(event) => setRemoveBackground(event.target.checked)}
              disabled={processing || importingAttachments}
            />
            Sin fondo (quitar fondo predominante)
          </label>

          <label>
            <input
              type="checkbox"
              checked={extractPsdLayers}
              onChange={(event) => setExtractPsdLayers(event.target.checked)}
              disabled={processing || importingAttachments}
            />
            Extraer por capas (PSD)
          </label>

          <label>
            <input
              type="checkbox"
              checked={exportPsdLayersRealSize}
              onChange={(event) => setExportPsdLayersRealSize(event.target.checked)}
              disabled={processing || importingAttachments || !extractPsdLayers}
            />
            Capas PSD a tamano real (100%)
          </label>

          <label>
            <input
              type="checkbox"
              checked={generateDominantBackground}
              onChange={(event) => setGenerateDominantBackground(event.target.checked)}
              disabled={processing || importingAttachments || removeBackground}
            />
            Fondo adicional con color predominante
          </label>

          <label>
            Fondo fallback
            <select
              value={fallbackBackground}
              onChange={(event) => setFallbackBackground(event.target.value)}
              disabled={processing || importingAttachments || removeBackground}
            >
              <option value="#ffffff">Blanco</option>
              <option value="#000000">Negro</option>
              <option value="#f0f0f0">Gris claro</option>
            </select>
          </label>
        </div>

        <div className="progress-line">
          <progress value={progress.done} max={progress.total || 1} />
          <span>{progress.done}/{progress.total}</span>
          <span>Items OK: {okCount} | Error: {errorCount} | Salidas: {outputCount}</span>
        </div>

        {globalMessage ? <p className="message">{globalMessage}</p> : null}

        <input
          ref={filesInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.tif,.tiff,.psd"
          onChange={(event) => {
            appendFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(event) => {
            appendFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </section>

      <section className="panel content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Estado</th>
                <th>Salida</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.id === selectedId ? "selected" : ""}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setSelectedId(item.id)}>
                      {item.file.name}
                    </button>
                    <div className="dim">{item.sourceWidth > 0 ? `${item.sourceWidth}x${item.sourceHeight}` : "-"}</div>
                  </td>
                  <td>
                    <span className={`status ${item.status}`}>{item.status}</span>
                    <div className="dim">{item.message || "-"}</div>
                  </td>
                  <td className="mono">{outputLabel(item)}</td>
                  <td>
                    <button
                      type="button"
                      className="small"
                      onClick={() => handleDownloadItem(item)}
                      disabled={!item.outputs || item.outputs.length === 0}
                    >
                      Descargar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="preview">
          <h3>Previsualizacion</h3>
          {selectedItem ? (
            <>
              <p>{selectedItem.file.name}</p>
              <img src={previewUrl(selectedItem)} alt="Preview" className="preview-image" />
              <p className="dim">Salidas: {selectedItem.outputs?.length || 0}</p>
            </>
          ) : (
            <p>Selecciona un archivo para ver vista previa.</p>
          )}
        </aside>
      </section>

      <section className="panel trello">
        <div className="trello-head">
          <h2>Trello</h2>
          <button type="button" onClick={loadBoards} disabled={trelloLoading || processing}>
            {trelloLoading ? "Cargando..." : "Leer tableros"}
          </button>
        </div>
        {trelloError ? <p className="error">{trelloError}</p> : null}

        <div className="trello-grid">
          <label>
            Tablero
            <select value={selectedBoard} onChange={(event) => loadLists(event.target.value)} disabled={trelloLoading}>
              <option value="">Selecciona...</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Lista
            <select value={selectedList} onChange={(event) => loadCards(event.target.value)} disabled={trelloLoading || !selectedBoard}>
              <option value="">Selecciona...</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="trello-cards">
          <div className="trello-cards-head">
            <h4>Tarjetas de la lista</h4>
            <div className="trello-card-tools">
              <button
                type="button"
                className="ghost small"
                onClick={selectAllCards}
                disabled={!cards.length || processing || importingAttachments}
              >
                Seleccionar todas
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={clearCardSelection}
                disabled={!selectedCardIds.length || processing || importingAttachments}
              >
                Limpiar
              </button>
            </div>
          </div>

          {!selectedList ? (
            <p className="dim">Selecciona una lista para ver sus tarjetas.</p>
          ) : cards.length === 0 ? (
            <p className="dim">No hay tarjetas en esta lista.</p>
          ) : (
            <ul className="card-list">
              {cards.map((card) => (
                <li key={card.id}>
                  <label className="card-row">
                    <input
                      type="checkbox"
                      checked={selectedCardIds.includes(card.id)}
                      onChange={() => toggleCardSelection(card.id)}
                      disabled={processing || importingAttachments}
                    />
                    <span>{card.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className="dim">Tarjetas seleccionadas: {selectedCardIds.length}</p>
        </div>

        <div className="trello-actions">
          <label>
            <input
              type="checkbox"
              checked={autoResizeTrelloImport}
              onChange={(event) => setAutoResizeTrelloImport(event.target.checked)}
              disabled={processing || importingAttachments}
            />
            Al extraer, pasar directo por el redimensionador
          </label>

          <button
            type="button"
            onClick={importCardImages}
            disabled={selectedCardIds.length === 0 || importingAttachments || processing}
          >
            {importingAttachments ? "Importando..." : "Extraer imagenes de tarjetas seleccionadas"}
          </button>
        </div>

        <div>
          <h4>Adjuntos imagen detectados (ultima importacion)</h4>
          {attachments.length === 0 ? (
            <p className="dim">Sin adjuntos cargados todavia.</p>
          ) : (
            <ul className="list">
              {attachments.map((attachment) => (
                <li key={`${attachment.cardId}-${attachment.id}`}>
                  {attachment.cardName}: {attachment.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
