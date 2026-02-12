import { fetchBoards } from "../_trelloClient.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  try {
    const result = await fetchBoards();
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json({ boards: result.boards });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Error interno en Trello boards."
    });
  }
}
