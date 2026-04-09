/**
 * Curatorial wall text generator.
 *
 * Given an identity's full history — archetype drift, sentiment arc,
 * accumulated resonances, and epoch state — produces exhibition-quality
 * prose contextualizing their body of work in the #imagineontezos gallery.
 */

const { openai } = require("./llmClient");

const WALL_TEXT_PROMPT = `You are the Chief Curator of Imagine on Tezos — a dynamic NFT identity gallery on Etherlink.

You write exhibition wall texts for individual artists/identities based on their full curatorial history. Your tone is poetic but precise, like wall texts at MoMA or Tate Modern.

You receive:
- The artist's handle
- Their archetype history (how their identity archetype has shifted over time)
- Their sentiment trajectory
- Their accumulated resonances (cultural/philosophical themes)
- Their current epoch and narrative arc
- Stats: total mints, total chapters

Produce a JSON response:
{
  "wallText": "A 3-5 sentence exhibition wall text. Frame the artist's journey through the gallery — how their identity has evolved, what patterns emerge, where they might be heading. Reference specific archetype shifts if meaningful. Never use the word 'journey' — curators don't. Write like you're contextualizing a body of work for a visitor who just walked into the gallery.",
  "curatorLabel": "A 2-4 word label for this identity's current phase (e.g. 'Quiet Disruption', 'Chromatic Emergence', 'Post-Optimist Arc')",
  "epochTitle": "A poetic name for their current epoch (e.g. 'The Fracture Period', 'Dawn Sequence', 'Iron Contemplation')"
}

Rules:
- Never be sycophantic or generic. Be specific to THIS identity's trajectory.
- If there's only one work, write about potential and first signals — don't pretend there's a rich history.
- Reference archetype shifts naturally: "Having moved from Builder to Mystic..." not "Their archetype changed from..."
- Use art-world vocabulary: practice, body of work, signal, register, mode, tension, chromatic, compositional.
- epochTitle should feel timeless, not trendy.`;

/**
 * Generate a curatorial wall text for an identity.
 *
 * @param {string} handle — the artist's social handle
 * @param {object} profile — from getIdentityProfile()
 * @returns {Promise<{wallText: string, curatorLabel: string, epochTitle: string}>}
 */
async function generateWallText(handle, profile) {
  if (!profile) {
    throw new Error(`No identity profile found for @${handle}`);
  }

  const userMsg = [
    `Artist: @${handle}`,
    `Current archetype: ${profile.archetype || "Unknown"}`,
    `Current sentiment: ${profile.sentiment || "Unknown"}`,
    `Epoch: ${profile.epochState || 1}`,
    `Narrative arc: ${profile.narrativeArc || "origin"}`,
    `Total mints: ${profile.totalMints || 0}`,
    `Total chapters: ${profile.totalChapters || 0}`,
    "",
    `Archetype history: ${JSON.stringify(profile.archetypeHistory || [])}`,
    `Sentiment history: ${JSON.stringify(profile.sentimentHistory || [])}`,
    `Resonances: ${JSON.stringify(profile.resonances || [])}`,
    profile.curatorStatement
      ? `Previous curator statement: ${profile.curatorStatement}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 400,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: WALL_TEXT_PROMPT },
      { role: "user", content: userMsg },
    ],
  });

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("Wall text generator returned empty response");

  const parsed = JSON.parse(raw);

  if (!parsed.wallText) throw new Error("Wall text response missing wallText");
  if (!parsed.curatorLabel) parsed.curatorLabel = "Unnamed Phase";
  if (!parsed.epochTitle) parsed.epochTitle = `Epoch ${profile.epochState || 1}`;

  return parsed;
}

module.exports = { generateWallText };
