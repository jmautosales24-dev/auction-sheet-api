export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ status: "Error", summary: "Use POST" });

  try {
    const { image_url, image_base64 } = req.body || {};
    if (!image_url && !image_base64) {
      return res.status(400).json({ status: "Error", summary: "image_url or image_base64 is required" });
    }

    const apiKey = process.env.GCV_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ status: "Error", summary: "Missing GCV_API_KEY" });
    }

    // Build Vision request
    const requestBody = {
      requests: [
        {
          image: image_url
            ? { source: { imageUri: image_url } }
            : { content: image_base64 }, // raw base64 without data: prefix
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
        }
      ]
    };

    const gcv = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const gcvJson = await gcv.json();
    if (!gcv.ok || !gcvJson?.responses || gcvJson.responses.length === 0) {
      const detail = JSON.stringify(gcvJson);
      return res.status(502).json({ status: "Error", summary: "Vision API failed", detail });
    }

    const resp = gcvJson.responses[0];
    const text =
      resp.fullTextAnnotation?.text ||
      (resp.textAnnotations && resp.textAnnotations[0]?.description) ||
      "";

    // ---- Extraction helpers ----
    const clean = (t) => (t || "").replace(/\r/g, "").trim();

    function extractGrade(t) {
      t = clean(t);
      // 評価点: 4.5 / 4 / 3.5 / R / RA / S etc.
      const m1 = t.match(/評価[点度]?\s*[:：]?\s*(S|[0-6](?:\.[05])?|RA?|R)\b/i);
      if (m1) return m1[1].toUpperCase();
      const m2 = t.match(/\b(S|[0-6](?:\.[05])?|RA?|R)\b\s*点?/i);
      if (m2) return m2[1].toUpperCase();
      // Sometimes just "4.5" appears standalone
      const m3 = t.match(/\b([0-6](?:\.[05])?|S|RA?|R)\b/iu);
      if (m3) return m3[1].toUpperCase();
      return null;
    }

    function extractMileage(t) {
      t = clean(t);
      // 走行距離 75,000 km / 75000km / km without comma
      const m1 = t.match(/走行距離[^\n]*?([\d,]{3,8})\s*km/i);
      if (m1) return Number(m1[1].replace(/,/g, ""));
      const m2 = t.match(/\b([\d,]{3,8})\s*km\b/i);
      if (m2) return Number(m2[1].replace(/,/g, ""));
      return null;
    }

    function extractYear(t) {
      t = clean(t);
      // Western year first
      const y1 = t.match(/\b(20\d{2})\b/);
      if (y1) return Number(y1[1]);

      // Japanese era: 平成(H) = 1988 + n, 令和(R) = 2018 + n
      const era = t.match(/(平成|令和)\s*(\d{1,2})\s*年/);
      if (era) {
        const n = Number(era[2]);
        if (era[1] === "平成") return 1988 + n;
        if (era[1] === "令和") return 2018 + n;
      }
      return null;
    }

    const rawText = clean(text);
    const auction_grade = extractGrade(rawText);
    const mileage_km = extractMileage(rawText);
    const year = extractYear(rawText);

    // ---- Scoring ----
    const gradeMap = { S: 100, "6": 95, "5": 90, "4.5": 85, "4": 75, "3.5": 60, "3": 45, R: 35, RA: 30, "2": 25, "1": 15, "0": 0 };
    const gKey = (auction_grade || "").toUpperCase();
    const gradeScore = gKey in gradeMap ? gradeMap[gKey] : 40;

    let mileageScore;
    if (mileage_km == null) mileageScore = 40;
    else if (mileage_km <= 80000) mileageScore = 40;
    else if (mileage_km <= 110000) mileageScore = 28;
    else if (mileage_km <= 150000) mileageScore = 18;
    else mileageScore = 8;

    let yearScore;
    if (!year) yearScore = 20;
    else if (year >= 2018) yearScore = 20;
    else if (year >= 2013) yearScore = 14;
    else if (year >= 2008) yearScore = 8;
    else yearScore = 4;

    const score = Math.max(0, Math.min(100, Math.round(0.5 * gradeScore + 0.3 * mileageScore + 0.2 * yearScore)));
    const status = score >= 80 ? "Good Buy" : score < 50 ? "Avoid" : "Caution";
    const summary = `OCR ok. Grade: ${auction_grade ?? "N/A"}, Mileage: ${mileage_km ?? "N/A"} km, Year: ${year ?? "N/A"} (Score ${score})`;

    return res.status(200).json({
      status,
      score,
      summary,
      data: {
        auction_grade,
        mileage_km,
        year,
        raw_text: rawText
      }
    });
  } catch (err) {
    return res.status(500).json({ status: "Error", summary: String(err.message || err) });
  }
}
