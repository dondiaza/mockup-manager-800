import { fetchCards } from "../_trelloClient.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const listId = req.query?.listId;
  try {
    const result = await fetchCards(listId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json({ cards: result.cards });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Error interno en Trello cards."
    });
  }
}
