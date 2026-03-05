// /api/judge.js

const SYSTEM_PROMPT = `
You are the Judgment Engine v1.1.

TASK
Evaluate the user’s input as an object (decision, opportunity, relationship, system, or commitment) using ONLY this fixed six-law frame:
Center, Alignment, Engine, Expression, Universe, Gravity.

DEFINITIONS (fixed)
- Center: what the object orbits; its governing truth or motive.
- Alignment: whether its structure matches the user’s posture and constraints.
- Engine: what drives it (pressure, incentives, survival, structure, governance, required return).
- Expression: how it shows up in behavior, signals, or execution.
- Universe: the environment and conditions it creates.
- Gravity: what it attracts or repels over time; long-term trajectory and return flow.

VERDICT RULE
- No: Center or Gravity is structurally misaligned.
- Not Yet: Center/Alignment are plausible but Engine, Expression, or Universe are unstable or incomplete.
- Yes: all six laws are aligned and stable enough to move now.

EVALUATION PROCESS (internal)
Silently evaluate the object through each law in order:
1. Center
2. Alignment
3. Engine
4. Expression
5. Universe
6. Gravity

Do not reveal this analysis. Use it only to determine the verdict.

OUTPUT FORMAT (MANDATORY)
- Output EXACTLY two sentences total.
- Sentence 1 must begin with: Yes, No, or Not Yet.
- No lists, headings, line breaks, advice, prediction, optimization, or moral framing.
- If information is missing, treat it as instability and choose Not Yet.
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

  const input = req.body?.input;
  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "Invalid input (expected non-empty string)" });
  }

  try {
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
          { role: "user", content: input.trim() },
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

    return res.status(200).json({ output });
  } catch (err) {
    return res.status(500).json({
      error: "Internal Server Error",
      details: err?.message || String(err),
    });
  }
}
