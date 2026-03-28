const { openai } = require("./llmClient");

const SYSTEM_PROMPT = `You are a Tezos art curator AI. Given a social-media post about #imagineontezos, analyse the post and return a JSON object with EXACTLY this shape (no markdown, no wrapping):

{
  "themes": ["string", ...],
  "tone": "string",
  "score": <number from {0.2, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9}>,
  "curatorDescription": "string"
}

Rules:
- "themes": 1-3 labels chosen ONLY from this vocabulary: "finance", "governance", "ai", "art", "tezos", "landscape", "identity", "general". Do not invent new labels.
- "tone": one word describing the overall tone (e.g. "reflective", "intense", "playful").
- "score": a relevance/quality score. Use 0.2-0.3 for spam/off-topic, 0.5 for borderline, 0.6-0.9 for good/exceptional.
- "curatorDescription": a concise 1-2 sentence curatorial statement about the post.

Return ONLY the JSON object, nothing else.`;

// --- Controlled theme vocabulary + normalizer ---

const THEME_VOCAB = [
  "finance",
  "governance",
  "ai",
  "art",
  "tezos",
  "landscape",
  "identity",
  "general",
];

function normalizeThemeLabel(raw) {
  const t = raw.toLowerCase();
  if (t.includes("finance") || t.includes("market") || t.includes("infrastructure"))
    return "finance";
  if (t.includes("governance") || t.includes("dao") || t.includes("voting"))
    return "governance";
  if (t === "ai" || t.includes("agent") || t.includes("llm") || t.includes("machine"))
    return "ai";
  if (t.includes("art") || t.includes("visual") || t.includes("image") || t.includes("generative"))
    return "art";
  if (t.includes("tezos") || t.includes("etherlink") || t.includes("blockchain") || t.includes("chain"))
    return "tezos";
  if (t.includes("landscape") || t.includes("city") || t.includes("environment") || t.includes("canvas"))
    return "landscape";
  if (t.includes("identity") || t.includes("persona") || t.includes("self"))
    return "identity";
  return "general";
}

function normalizeThemes(rawThemes) {
  const mapped = rawThemes.map(normalizeThemeLabel);
  return [...new Set(mapped)];
}

// --- Score clamping ---

function clampScore(raw) {
  let s = typeof raw === "number" ? raw : 0.5;
  if (s < 0.2) return 0.2;
  if (s > 0.95) return 0.95;
  return s;
}

// --- Retry wrapper ---

async function callCuratorLLM(rawText, handle) {
  const maxRetries = 3;
  let delayMs = 500;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await openai.responses.create({
        model: "gpt-4.1-nano",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Post by @${handle}:\n\n"${rawText}"`,
          },
        ],
        text: { format: { type: "json_object" } },
      });

      const text = response.output_text;
      const parsed = JSON.parse(text);

      if (
        !Array.isArray(parsed.themes) ||
        typeof parsed.tone !== "string" ||
        typeof parsed.score !== "number" ||
        typeof parsed.curatorDescription !== "string"
      ) {
        throw new Error(`Unexpected LLM response shape: ${text}`);
      }

      return parsed;
    } catch (err) {
      console.error("curator LLM error/parse fail, attempt", i + 1, err.message || err);
      if (i === maxRetries - 1) break;
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }

  // Fallback: simple heuristic
  return {
    themes: ["general"],
    tone: "neutral",
    score: 0.5,
    curatorDescription: `Fallback curator for ${handle}: generic interpretation.`,
  };
}

// --- Main export ---

async function curatePostWithLLM(rawText, handle) {
  // Test overrides for deterministic branch testing
  if (rawText.includes("[FORCE_SKIP]")) {
    return {
      themes: normalizeThemes(["general"]),
      tone: "neutral",
      score: 0.3,
      curatorDescription: `Forced skip for ${handle}.`,
      metadataUri: "",
      chapterUri: "",
    };
  }
  if (rawText.includes("[FORCE_CHAPTER]")) {
    return {
      themes: normalizeThemes(["finance", "tezos"]),
      tone: "reflective",
      score: 0.8,
      curatorDescription: `Forced chapter for ${handle}.`,
      metadataUri: "",
      chapterUri: "",
    };
  }

  const llm = await callCuratorLLM(rawText, handle);

  return {
    themes: normalizeThemes(llm.themes || []),
    tone: llm.tone || "neutral",
    score: clampScore(llm.score),
    curatorDescription: llm.curatorDescription || "",
    metadataUri: "",
    chapterUri: "",
  };
}

module.exports = { curatePostWithLLM, normalizeThemes, normalizeThemeLabel, clampScore };
