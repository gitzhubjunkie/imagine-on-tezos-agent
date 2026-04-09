const { openai } = require("./llmClient");

const SYSTEM_PROMPT = `You are Imagine on Tezos — an AI curator for a dynamic NFT identity gallery on Etherlink.

Given a social media post tagged #imagineontezos, produce a deterministic curatorial interpretation. Your output is structured JSON only — no commentary, no markdown fence.

Output schema:
{
  "title": "short poetic title (3-7 words)",
  "summary": "1-2 sentence curatorial interpretation of the post's meaning and identity signal",
  "archetype": one of ["Builder", "Dreamer", "Dissenter", "Mystic", "Observer", "Pioneer", "Guardian", "Trickster"],
  "sentiment": one of ["visionary", "bullish", "conflicted", "elegiac", "militant", "playful", "contemplative", "defiant"],
  "keywords": ["3-6 thematic keywords"],
  "traits": [
    { "trait_type": "Archetype", "value": "<archetype>" },
    { "trait_type": "Sentiment", "value": "<sentiment>" },
    { "trait_type": "Hashtag", "value": "#imagineontezos" }
  ],
  "palette": ["3-5 hex color codes that evoke the post's mood"],
  "motionMode": one of ["calm", "pulse", "fracture", "bloom", "drift", "flicker"],
  "visualPrompt": "A precise image generation prompt (1-2 sentences) describing an abstract identity portrait derived from the post's meaning. No text, no faces, no logos. Focus on atmosphere, texture, geometry, light.",
  "epochState": 1
}

Rules:
- Be deterministic: same input should produce the same archetype and sentiment.
- palette[0] is the dominant background color, palette[1] is the accent.
- visualPrompt must be abstract/conceptual, never literal screenshots or portraits.
- title should feel like a gallery exhibition label.
- summary should read like a museum wall text — concise, interpretive, never sycophantic.
- keywords should be concrete nouns and verbs, not generic adjectives.`;

/**
 * Run AI interpretation on a normalized post.
 * @param {{ text: string, authorHandle?: string, source?: string, hashtags?: string[] }} post
 * @returns {Promise<object>} Structured AI interpretation
 */
async function interpretPost(post) {
  const userMsg = [
    `Source: ${post.source || "x"}`,
    post.authorHandle ? `Author: @${post.authorHandle}` : "",
    `Text: ${post.text}`,
    post.hashtags?.length ? `Hashtags: ${post.hashtags.map((h) => "#" + h).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
  });

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("AI returned empty response");

  const parsed = JSON.parse(raw);

  // Validate required fields
  const required = ["title", "summary", "archetype", "sentiment", "palette", "motionMode", "visualPrompt"];
  for (const k of required) {
    if (!parsed[k]) throw new Error(`AI response missing field: ${k}`);
  }

  // Ensure epochState defaults to 1
  if (!parsed.epochState) parsed.epochState = 1;

  // Ensure traits array exists
  if (!Array.isArray(parsed.traits)) {
    parsed.traits = [
      { trait_type: "Archetype", value: parsed.archetype },
      { trait_type: "Sentiment", value: parsed.sentiment },
      { trait_type: "Hashtag", value: "#imagineontezos" },
    ];
  }

  return parsed;
}

module.exports = { interpretPost };
