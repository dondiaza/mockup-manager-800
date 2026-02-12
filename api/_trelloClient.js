const BASE_URL = "https://api.trello.com/1";

async function readTrelloPayload(response) {
  const text = await response.text();
  try {
    return {
      text,
      json: JSON.parse(text)
    };
  } catch {
    return {
      text,
      json: null
    };
  }
}

function getCredentials() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    return {
      ok: false,
      message:
        "Faltan variables de entorno: TRELLO_API_KEY y/o TRELLO_TOKEN. Configuralas en Vercel."
    };
  }
  return {
    ok: true,
    key,
    token
  };
}

function withAuth(path, key, token) {
  const separator = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${separator}key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

function withAuthAbsolute(url, key, token) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

function trelloDownloadOAuthHeader(key, token) {
  return `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`;
}

function isImageAttachment(attachment) {
  const mime = attachment?.mimeType || "";
  const name = attachment?.name || "";
  const url = attachment?.url || "";
  return (
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|tiff?|psd)$/i.test(name) ||
    /\.(png|jpe?g|webp|tiff?|psd)(\?|$)/i.test(url)
  );
}

export async function fetchBoards() {
  const creds = getCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      status: 400,
      error: creds.message
    };
  }

  const url = withAuth("/members/me/boards?fields=id,name,url,closed", creds.key, creds.token);
  const response = await fetch(url);
  const payload = await readTrelloPayload(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.json?.message || payload.text || "Error consultando tableros en Trello."
    };
  }

  return {
    ok: true,
    status: 200,
    boards: (payload.json || []).filter((board) => !board.closed)
  };
}

export async function fetchLists(boardId) {
  if (!boardId) {
    return {
      ok: false,
      status: 400,
      error: "Falta boardId."
    };
  }

  const creds = getCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      status: 400,
      error: creds.message
    };
  }

  const url = withAuth(
    `/boards/${encodeURIComponent(boardId)}/lists?fields=id,name,closed`,
    creds.key,
    creds.token
  );
  const response = await fetch(url);
  const payload = await readTrelloPayload(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.json?.message || payload.text || "Error consultando listas del tablero."
    };
  }

  return {
    ok: true,
    status: 200,
    lists: payload.json || []
  };
}

export async function fetchCards(listId) {
  if (!listId) {
    return {
      ok: false,
      status: 400,
      error: "Falta listId."
    };
  }

  const creds = getCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      status: 400,
      error: creds.message
    };
  }

  const url = withAuth(
    `/lists/${encodeURIComponent(listId)}/cards?fields=id,name,closed`,
    creds.key,
    creds.token
  );
  const response = await fetch(url);
  const payload = await readTrelloPayload(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.json?.message || payload.text || "Error consultando tarjetas de la lista."
    };
  }

  const cards = (payload.json || []).filter((card) => !card.closed);
  return {
    ok: true,
    status: 200,
    cards
  };
}

export async function fetchCardAttachments(cardId) {
  if (!cardId) {
    return {
      ok: false,
      status: 400,
      error: "Falta cardId."
    };
  }

  const creds = getCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      status: 400,
      error: creds.message
    };
  }

  const url = withAuth(
    `/cards/${encodeURIComponent(cardId)}/attachments?fields=id,name,mimeType,url,isUpload`,
    creds.key,
    creds.token
  );
  const response = await fetch(url);
  const payload = await readTrelloPayload(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.json?.message || payload.text || "Error consultando adjuntos de la tarjeta."
    };
  }

  const attachments = (payload.json || []).filter(isImageAttachment);
  return {
    ok: true,
    status: 200,
    attachments
  };
}

function safeFileName(value, fallback = "attachment.png") {
  const text = (value || "").trim();
  const normalized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

export async function fetchAttachmentBinary(cardId, attachmentId) {
  if (!cardId || !attachmentId) {
    return {
      ok: false,
      status: 400,
      error: "Faltan cardId y/o attachmentId."
    };
  }

  const creds = getCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      status: 400,
      error: creds.message
    };
  }

  const metadataUrl = withAuth(
    `/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}?fields=id,name,mimeType,url,fileName`,
    creds.key,
    creds.token
  );
  const metadataResponse = await fetch(metadataUrl);
  const metadataPayload = await readTrelloPayload(metadataResponse);
  if (!metadataResponse.ok) {
    return {
      ok: false,
      status: metadataResponse.status,
      error: metadataPayload.json?.message || metadataPayload.text || "No se pudo leer el adjunto."
    };
  }

  const attachment = metadataPayload.json;
  if (!isImageAttachment(attachment)) {
    return {
      ok: false,
      status: 400,
      error: "El adjunto no es una imagen soportada."
    };
  }

  const rawUrl = attachment.url;
  const isTrelloHosted = /https:\/\/(trello\.com|api\.trello\.com)\/1\/cards\//i.test(rawUrl);
  const oauthHeaders = {
    Authorization: trelloDownloadOAuthHeader(creds.key, creds.token),
    Accept: "*/*"
  };

  let fileResponse = null;
  if (isTrelloHosted) {
    const apiDownloadUrl = rawUrl.replace(/^https:\/\/trello\.com\/1\//i, "https://api.trello.com/1/");
    fileResponse = await fetch(apiDownloadUrl, { headers: oauthHeaders });
    if (!fileResponse.ok) {
      const fallbackUrl = withAuthAbsolute(apiDownloadUrl, creds.key, creds.token);
      fileResponse = await fetch(fallbackUrl, { headers: { Accept: "*/*" } });
    }
  } else {
    fileResponse = await fetch(rawUrl);
  }

  if (!fileResponse || !fileResponse.ok) {
    const errorPayload = fileResponse ? await readTrelloPayload(fileResponse) : { text: "", json: null };
    return {
      ok: false,
      status: fileResponse?.status || 500,
      error: errorPayload.json?.message || errorPayload.text || "No se pudo descargar el adjunto."
    };
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const fileName = safeFileName(attachment.fileName || attachment.name || `attachment_${attachmentId}.png`);
  const contentType = fileResponse.headers.get("content-type") || attachment.mimeType || "application/octet-stream";

  return {
    ok: true,
    status: 200,
    fileName,
    contentType,
    data: Buffer.from(arrayBuffer)
  };
}
