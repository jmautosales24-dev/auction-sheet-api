export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { image_url } = req.body || {};
    if (!image_url) return res.status(400).json({ error: "image_url is required" });

    // TODO: Replace with real OCR + translation.
    // For now, we fake some extracted values for testing:
    const extracted = {
      make: "Honda",
      model: "Vezel",
      year: 2019,
      auction_grade: "4.5",
      interior_grade: "B",
      exterior_grade: "B",
      mileage_km: 65000,
      notes: "No accident history, clean interior."
    };

    // -------------------------------
    // SCORING LOGIC STARTS HERE
    // -------------------------------
    const gradeMap = { S:100, "6":95, "5":90, "4.5":85, "4":75, "3.5":60, "3":45, R:35, RA:30, "2":25, "1":15, "0":0 };
    const g = String(extracted.auction_grade || "").toUpperCase().trim();
    const gradeScore = gradeMap[g] ?? 40;

    const mileage = extracted.mileage_km;
    let mileageScore = mileage == null ? 40 : mileage <= 80000 ? 40 : mileage <= 110000 ? 28 : mileage <= 150000 ? 18 : 8;

    const year = extracted.year;
    let yearScore = !year ? 20 : year >= 2018 ? 20 : year >= 2013 ? 14 : year >= 2008 ? 8 : 4;

    const notes = (extracted.notes || "").toLowerCase();
    const badFlags = ["accident", "repair history", "rust", "corrosion", "panel replaced", "flood"];
    const flagsHit = badFlags.some(k => notes.includes(k));

    const score = Math.max(0, Math.min(100, Math.round(
      0.4 * gradeScore +
      0.25 * mileageScore +
      0.15 * yearScore +
      0.2 * (flagsHit ? 0 : 15)
    )));

    const status = score >= 80 ? "Good Buy" : score < 50 ? "Avoid" : "Caution";
    const summary =
      `Grade: ${extracted.auction_grade ?? "N/A"}, ` +
      `Mileage: ${mileage ?? "N/A"} km, Year: ${year ?? "N/A"}` +
      (flagsHit ? " (issues noted)" : "");

    // -------------------------------
    // RESPONSE
    // -------------------------------
    return res.status(200).json({
      status,
      score,
      summary,
      data: extracted
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
