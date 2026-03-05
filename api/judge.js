export default async function handler(req, res) {
  try {
    const { input } = req.body;

    const systemPrompt = `
You are the Judgment Engine v1.0.
Your output must be one of: Yes, No, or Not Yet.
After the verdict, add exactly two sentences explaining the reasoning.
Keep the tone neutral, structured, and consistent.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input }
        ]
      })
    });

    const data = await response.json();
    const output = data.choices?.[0]?.message?.content || "Error: No response";

    res.status(200).json({ output });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
}
