export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ error: "Method Not Allowed" });
}

const { input } = req.body;

const systemPrompt = `
You are the Judgment Engine v1.0.
Your output must be one of: Yes, No, or Not Yet.
After the verdict, add exactly two sentences explaining the reasoning.
Keep the tone neutral, structured, and consistent.
`;

try {
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

const output = data.choices?.[0]?.message?.content || null;

if (!output) {
return res.status(500).json({ error: "No output from model" });
}

return res.status(200).json({ output });

} catch (err) {
return res.status(500).json({
