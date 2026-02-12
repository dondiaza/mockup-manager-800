import { fetchLists } from "../_trelloClient.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const boardId = req.query?.boardId;
  try {
    const result = await fetchLists(boardId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json({ lists: result.lists });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Error interno en Trello lists."
    });
  }
}
