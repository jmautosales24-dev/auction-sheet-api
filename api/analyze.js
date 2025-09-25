// /api/analyze.js — OpenAI Vision + Scoring
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { image_url } = req.body || {};
    if (!image_url) return res.status(400).json({ error: "image_url is required" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        hint: "Add it in Vercel → Project → Settings → Environment Variables"
      });
    }

    // Ask OpenAI Vision to read JP auction sheet → return structured JSON in English
    const jsonSchema = {
      name: "auction_sheet_extraction",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          make: { type: "string" },
          model: { type: "string" },
          year: { type: "integer", minimum: 1970, maximum: 2100 },
          auction_grade: { type: "string" },
          interior_grade: { type: "string" },
          exterior_grade: { type: "string" },
          mileage_km: { type: "integer", minimum: 0 },
          notes: { type: "string" }
        },
        required: ["make", "model"]
      }
    };

    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You read Japanese car auction sheets from an image. Translate to English and return ONLY JSON per schema. Do not invent values."
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract details from this auction sheet and output ONLY JSON." },
              { type: "image_url", image_url: { url: image_url } }
            ]
          }
        ],
        response_format: { type: "json_schema", json_schema: jsonSchema },
        temperature: 0.2
      })
    });

    if (!ai.ok) {
      const t = await ai.text();
      return res.status(502).json({ error: "OpenAI error", detail: t });
    }

    const aiJson = await ai.json();
    const content = aiJson?.choices?.[0]?.message?.content || "{}";
    let extracted = {};
    try { extracted = JSON.parse(content); } catch { extracted = {}; }

    // Normalize
    const num = (v) => {
      if (v == null) return null;
      const n = Number(String(v).replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? Math.round(n) : null;
    };

    const data = {
      make: extracted.make ?? null,
      model: extracted.model ?? null,
      year: num(extracted.year),
      auction_grade: extracted.auction_grade ?? null,
      interior_grade: extracted.interior_grade ?? null,
      exterior_grade: extracted.exterior_grade ?? null,
      mileage_km: num(extracted.mileage_km),
      notes: extracted.notes ?? ""
    };

    // ---- Scoring ----
    const gradeMap = { S:100, "6":95, "5":90, "4.5":85, "4":75, "3.5":60, "3":45, R:35, RA:30, "2":25, "1":15, "0":0 };
    const g = String(data.auction_grade || "").toUpperCase().trim();
    const gradeScore = gradeMap[g] ?? 40;

    const mileage = data.mileage_km;
    let mileageScore = mileage == null ? 40 : mileage <= 80000 ? 40 : mileage <= 110000 ? 28 : mileage <= 150000 ? 18 : 8;

    const year = data.year;
    let yearScore = !year ? 20 : year >= 2018 ? 20 : year >= 2013 ? 14 : year >= 2008 ? 8 : 4;

    const notes = (data.notes || "").toLowerCase();
    const badFlags = ["accident", "repair history", "rust", "corrosion", "panel replaced", "flood"];
    const flagsHit = badFlags.some(k => notes.includes(k));

    const score = Math.max(0, Math.min(100, Math.round(
      0.4 * gradeScore + 0.25 * mileageScore + 0.15 * yearScore + 0.2 * (flagsHit ? 0 : 15)
    )));
    const status = score >= 80 ? "Good Buy" : score < 50 ? "Avoid" : "Caution";
    const summary = `Grade: ${data.auction_grade ?? "N/A"}, Mileage: ${mileage ?? "N/A"} km, Year: ${year ?? "N/A"}${flagsHit ? " (issues noted)" : ""}`;

    return res.status(200).json({ status, score, summary, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}

