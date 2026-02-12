import { fetchAttachmentBinary } from "../_trelloClient.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const cardId = req.query?.cardId;
  const attachmentId = req.query?.attachmentId;
  try {
    const result = await fetchAttachmentBinary(cardId, attachmentId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${result.fileName}"`);
    res.status(200).send(result.data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Error interno descargando adjunto Trello."
    });
  }
}
