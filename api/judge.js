// /api/judge.js

const SYSTEM_PROMPT = `
You are the Judgment Engine v1.0.

You will receive four inputs: Domain, Motivation, Desired Outcome, and Decision.
Evaluate the decision using only these inputs.

Output a single verdict (Yes, No, or Not Yet) followed by exactly two sentences of reasoning in a neutral, consistent tone.
Do not ask questions, request more information, or reference the schema.
Return only the verdict and the two sentences.
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
      return res.status(200).json({
      output: "Not Yet. Stocks domain route is connected, but the stock engine endpoint is not attached yet."
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
