export default async function handler(req, res) {
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ status: "Error", summary: "Missing OPENAI_API_KEY" });
    }

    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an assistant that extracts Japanese auction sheet details. Respond in JSON only."
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract details and output JSON." },
              image_url ? { type: "image_url", image_url: { url: image_url } } : { type: "image_base64", image_url: { url: `data:image/jpeg;base64,${image_base64}` } }
            ]
          }
        ]
      })
    });

    if (!ai.ok) {
      const t = await ai.text();
      return res.status(502).json({ status: "Error", summary: "OpenAI request failed", detail: t });
    }

    const aiJson = await ai.json();
    let extracted = {};
    try {
      extracted = JSON.parse(aiJson?.choices?.[0]?.message?.content || "{}");
    } catch (e) {
      extracted = {};
    }

    // Always return consistent output
    return res.status(200).json({
      status: extracted.status || "Caution",
      summary: extracted.summary || "No summary available",
      data: extracted
    });
  } catch (err) {
    return res.status(500).json({ status: "Error", summary: err.message });
  }
}
