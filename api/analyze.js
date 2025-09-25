export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { image_url } = req.body || {};
  if (!image_url) {
    return res.status(400).json({ error: "image_url is required" });
  }

  // Stub response for testing
  return res.status(200).json({
    status: "Caution",
    score: 72,
    summary: "Stub mode response (replace later with real OCR/Translate).",
    data: {
      make: "Honda",
      model: "Vezel",
      year: 2019,
      auction_grade: "4.5",
      interior_grade: "B",
      exterior_grade: "A",
      mileage_km: 65000,
      notes: "No major issues (stub data)."
    }
  });
}
