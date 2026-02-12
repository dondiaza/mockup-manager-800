import { fetchCardAttachments } from "../_trelloClient.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const cardId = req.query?.cardId;
  try {
    const result = await fetchCardAttachments(cardId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json({ attachments: result.attachments });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Error interno en Trello card attachments."
    });
  }
}
