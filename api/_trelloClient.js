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
