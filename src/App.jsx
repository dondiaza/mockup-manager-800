import { useEffect, useMemo, useRef, useState } from "react";
import { buildOutputName, buildZipFromResults, downloadBlob } from "./lib/fileUtils";
import { isSupportedFile, processToSquarePng } from "./lib/imageProcessing";

function createItem(file) {
  return {
    id: `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
    fingerprint: `${file.name}-${file.lastModified}-${file.size}`,
    file,
    inputUrl: URL.createObjectURL(file),
    status: "pendiente",
    message: "",
    outputName: "",
    outputBlob: null,
    outputUrl: "",
    sourceWidth: 0,
    sourceHeight: 0
  };
}

function revokeItemUrls(item) {
  if (item.inputUrl) {
    URL.revokeObjectURL(item.inputUrl);
  }
  if (item.outputUrl) {
    URL.revokeObjectURL(item.outputUrl);
  }
}

export default function App() {
  const [items, setItems] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [overwriteDuplicates, setOverwriteDuplicates] = useState(true);
  const [background, setBackground] = useState("transparent");
  const [selectedId, setSelectedId] = useState("");
  const [globalMessage, setGlobalMessage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [trelloLoading, setTrelloLoading] = useState(false);
  const [trelloError, setTrelloError] = useState("");
  const [boards, setBoards] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState("");
  const [lists, setLists] = useState([]);

  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);

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
      items.forEach(revokeItemUrls);
    };
  }, [items]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const okCount = useMemo(() => items.filter((item) => item.status === "ok").length, [items]);
  const errorCount = useMemo(() => items.filter((item) => item.status === "error").length, [items]);

  function appendFiles(fileList) {
    const incoming = Array.from(fileList ?? []);
    if (!incoming.length) {
      return;
    }

    const supported = incoming.filter(isSupportedFile);
    const unsupportedCount = incoming.length - supported.length;
    const currentFingerprints = new Set(items.map((item) => item.fingerprint));

    const newItems = [];
    for (const file of supported) {
      const fingerprint = `${file.name}-${file.lastModified}-${file.size}`;
      if (currentFingerprints.has(fingerprint)) {
        continue;
      }
      currentFingerprints.add(fingerprint);
      newItems.push(createItem(file));
    }

    if (!newItems.length && unsupportedCount === 0) {
      setGlobalMessage("No se agregaron archivos nuevos.");
      return;
    }

    setItems((previous) => [...previous, ...newItems]);
    if (!selectedId && newItems.length > 0) {
      setSelectedId(newItems[0].id);
    }

    if (unsupportedCount > 0) {
      setGlobalMessage(
        `Se omitieron ${unsupportedCount} archivo(s) no soportado(s). Soportados: PNG/JPG/WEBP/TIFF/PSD.`
      );
    } else {
      setGlobalMessage(`Se agregaron ${newItems.length} archivo(s).`);
    }
  }

  async function handleProcessAll() {
    if (!items.length || processing) {
      return;
    }

    setProcessing(true);
    setGlobalMessage("");
    setProgress({ done: 0, total: items.length });
    const registry = new Map();

    const working = [...items];
    for (let index = 0; index < working.length; index += 1) {
      const current = working[index];
      if (current.outputUrl) {
        URL.revokeObjectURL(current.outputUrl);
      }

      current.status = "procesando";
      current.message = "Procesando...";
      current.outputBlob = null;
      current.outputUrl = "";
      current.outputName = "";
      setItems([...working]);

      try {
        const outputName = buildOutputName(current.file.name, registry, overwriteDuplicates);
        const result = await processToSquarePng(current.file, {
          size: 800,
          background
        });
        const outputUrl = URL.createObjectURL(result.blob);
        current.status = "ok";
        current.message = "Convertido a PNG 800x800 (contain, sin recorte).";
        current.outputBlob = result.blob;
        current.outputUrl = outputUrl;
        current.outputName = outputName;
        current.sourceWidth = result.sourceWidth;
        current.sourceHeight = result.sourceHeight;
      } catch (error) {
        current.status = "error";
        current.message = error instanceof Error ? error.message : "Error inesperado durante el proceso.";
        current.outputBlob = null;
        current.outputUrl = "";
      }

      setItems([...working]);
      setProgress({ done: index + 1, total: working.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setGlobalMessage("Proceso completado.");
    setProcessing(false);
  }

  function handleClear() {
    if (processing) {
      return;
    }
    items.forEach(revokeItemUrls);
    setItems([]);
    setSelectedId("");
    setProgress({ done: 0, total: 0 });
    setGlobalMessage("");
  }

  async function handleDownloadZip() {
    const okItems = items.filter((item) => item.status === "ok" && item.outputBlob);
    if (!okItems.length) {
      setGlobalMessage("No hay archivos procesados para descargar.");
      return;
    }
    setGlobalMessage("Construyendo ZIP...");
    const zipBlob = await buildZipFromResults(okItems);
    downloadBlob(zipBlob, "mockups_800_png.zip");
    setGlobalMessage("ZIP descargado.");
  }

  function handleDownloadOne(item) {
    if (item.status !== "ok" || !item.outputBlob || !item.outputName) {
      return;
    }
    downloadBlob(item.outputBlob, item.outputName);
  }

  async function loadBoards() {
    setTrelloLoading(true);
    setTrelloError("");
    setLists([]);
    setSelectedBoard("");
    try {
      const response = await fetch("/api/trello/boards");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "No se pudo leer Trello.");
      }
      setBoards(data.boards || []);
    } catch (error) {
      setBoards([]);
      setTrelloError(error instanceof Error ? error.message : "Error cargando tableros.");
    } finally {
      setTrelloLoading(false);
    }
  }

  async function loadLists(boardId) {
    setSelectedBoard(boardId);
    setLists([]);
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

  return (
    <main className="layout">
      <header className="hero">
        <h1>Gestor de Mockups Web</h1>
        <p>
          Convierte PNG/JPG/WEBP/TIFF/PSD a <strong>PNG 800x800</strong>, sin deformar y sin recortar.
        </p>
      </header>

      <section className="panel controls">
        <div className="actions">
          <button type="button" onClick={() => filesInputRef.current?.click()} disabled={processing}>
            Seleccionar archivos
          </button>
          <button type="button" onClick={() => folderInputRef.current?.click()} disabled={processing}>
            Seleccionar carpeta
          </button>
          <button type="button" onClick={handleProcessAll} disabled={processing || items.length === 0}>
            {processing ? "Procesando..." : "Procesar todo"}
          </button>
          <button type="button" onClick={handleDownloadZip} disabled={processing || okCount === 0}>
            Descargar ZIP
          </button>
          <button type="button" className="ghost" onClick={handleClear} disabled={processing}>
            Limpiar
          </button>
        </div>

        <div className="options">
          <label>
            <input
              type="checkbox"
              checked={overwriteDuplicates}
              onChange={(event) => setOverwriteDuplicates(event.target.checked)}
              disabled={processing}
            />
            Sobrescribir nombres duplicados
          </label>

          <label>
            Fondo de relleno
            <select value={background} onChange={(event) => setBackground(event.target.value)} disabled={processing}>
              <option value="transparent">Transparente</option>
              <option value="#ffffff">Blanco</option>
              <option value="#000000">Negro</option>
            </select>
          </label>
        </div>

        <div className="progress-line">
          <progress value={progress.done} max={progress.total || 1} />
          <span>
            {progress.done}/{progress.total}
          </span>
          <span>
            OK: {okCount} | Error: {errorCount}
          </span>
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
                  <td className="mono">{item.outputName || "-"}</td>
                  <td>
                    <button
                      type="button"
                      className="small"
                      onClick={() => handleDownloadOne(item)}
                      disabled={item.status !== "ok"}
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
              <img
                src={selectedItem.outputUrl || selectedItem.inputUrl}
                alt="Preview"
                className="preview-image"
              />
            </>
          ) : (
            <p>Selecciona un archivo para ver vista previa.</p>
          )}
        </aside>
      </section>

      <section className="panel trello">
        <div className="trello-head">
          <h2>Trello</h2>
          <button type="button" onClick={loadBoards} disabled={trelloLoading}>
            {trelloLoading ? "Cargando..." : "Leer tableros"}
          </button>
        </div>
        {trelloError ? <p className="error">{trelloError}</p> : null}

        <div className="trello-grid">
          <label>
            Tablero
            <select value={selectedBoard} onChange={(event) => loadLists(event.target.value)}>
              <option value="">Selecciona...</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <h4>Listas</h4>
            {lists.length === 0 ? (
              <p className="dim">Sin datos.</p>
            ) : (
              <ul className="list">
                {lists.map((list) => (
                  <li key={list.id}>
                    {list.name}
                    {list.closed ? " (cerrada)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
