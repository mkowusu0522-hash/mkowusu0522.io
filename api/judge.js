// /api/judge.js

const SYSTEM_PROMPT = `
You are the Judgment Engine v1.0.

You will receive four inputs: Domain, Motivation, Desired Outcome, and Decision.
Evaluate the decision using only these inputs.

Return:
1. A single verdict: Yes, No, or Not Yet.
2. Exactly one short sentence explaining the verdict.
3. A Five Moves explanation using these exact labels:
Value
Bottleneck
Unit Cash
Durability
Failure Point

Rules:
- Keep the tone neutral, direct, and consistent.
- Do not ask questions.
- Do not request additional information.
- Do not reference the schema.
- Do not give advice.
- Keep each Five Moves line brief and structural.
- Return only the verdict, the short explanation sentence, and the five labeled lines.
`.trim();

function isValidOutput(text) {
  const t = (text || "").trim();
  if (!/^(Yes|No|Not Yet)\b/.test(t)) return false;
  if (t.includes("\n")) return false;
  const sentences = t.match(/[^.!?]+[.!?]/g) || [];
  return sentences.length === 2;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { domain, motivation, desiredOutcome, decision } = req.body || {};

  if (
    typeof domain !== "string" || !domain.trim() ||
    typeof motivation !== "string" || !motivation.trim() ||
    typeof desiredOutcome !== "string" || !desiredOutcome.trim() ||
    typeof decision !== "string" || !decision.trim()
  ) {
    return res.status(400).json({
      error: "Missing/invalid required fields: domain, motivation, desiredOutcome, decision",
    });
  }

  const userContent =
    `Domain: ${domain.trim()}\n` +
    `Motivation: ${motivation.trim()}\n` +
    `Desired Outcome: ${desiredOutcome.trim()}\n` +
    `Decision: ${decision.trim()}`;

  try {
  if (domain.trim().toLowerCase() === "stocks") {
    const ticker = decision.trim().toUpperCase();
    const stockResponse = await fetch(`https://stock-engine-api.onrender.com/stock/${ticker}`);
    if (!stockResponse.ok) {
      return res.status(500).json({
        error: "Stock engine unavailable"
      });
    }
    const stockData = await stockResponse.json();

    return res.status(200).json({
      output: stockData.judgment_verdict
    });
  }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      return res.status(response.status).json({
        error: "OpenAI request failed",
        details: details || null,
      });
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content?.trim();

    if (!output) {
      return res.status(500).json({ error: "No output from model" });
    }

    if (!isValidOutput(output)) {
      return res.status(422).json({
        error: "Invalid format: output must be exactly two sentences starting with Yes, No, or Not Yet.",
        output,
      });
    }
    console.log({
      domain,
      motivation,
      desiredOutcome,
      decision,
      output,
      timestamp: new Date().toISOString()
    });
    
    return res.status(200).json({ output });
  } catch (err) {
    return res.status(500).json({
      error: "Internal Server Error",
      details: err?.message || String(err),
    });
  }
}
