/**
 * Curated Labs — Multi-agent curatorial panel.
 *
 * Three specialized AI curators each read a post through a different lens,
 * then a chief curator synthesizes their readings into a unified interpretation.
 *
 * Agents:
 *  - Chromatic Agent:  visual/aesthetic reading (palette, texture, motion, visual prompt)
 *  - Narrative Agent:  story/meaning reading (archetype, sentiment, title, summary)
 *  - Pattern Agent:    cross-identity patterns (keywords, epoch, themes, resonance)
 *
 * The chief curator merges all three into the final output, resolving conflicts
 * and producing richer metadata than any single agent could.
 */

const { openai } = require("./llmClient");

// ── Agent prompts ───────────────────────────────────────

const CHROMATIC_PROMPT = `You are the Chromatic Agent — a visual curator for the Imagine on Tezos identity gallery.

You analyze social media posts ONLY for their visual and aesthetic potential. You think in color, texture, geometry, and motion.

Given a post, return JSON:
{
  "palette": ["5 hex color codes that capture the post's visual energy — palette[0] is background, palette[1] is accent"],
  "motionMode": one of ["calm","pulse","fracture","bloom","drift","flicker"] — the kinetic energy of the post,
  "texture": one of ["smooth","gritty","crystalline","organic","metallic","woven"],
  "visualPrompt": "A precise 2-3 sentence image generation prompt. Abstract identity portrait: atmosphere, texture, geometry, light. No text, faces, or logos.",
  "visualNotes": "1 sentence on why you chose this visual direction"
}

Rules:
- Think like a color theorist and motion designer, not a writer.
- palette should create visual tension — never all similar hues.
- motionMode should match the post's energy: calm for contemplative, fracture for conflict, bloom for growth.
- visualPrompt must be painterly and abstract, never literal.`;

const NARRATIVE_PROMPT = `You are the Narrative Agent — a literary curator for the Imagine on Tezos identity gallery.

You analyze social media posts for their narrative meaning, identity signal, and archetypal resonance. You think like a museum curator writing wall text.

Given a post, return JSON:
{
  "title": "poetic exhibition title (3-7 words)",
  "summary": "2-3 sentence curatorial interpretation — what does this post reveal about the author's evolving identity? Write like museum wall text: concise, interpretive, never sycophantic.",
  "archetype": one of ["Builder","Dreamer","Dissenter","Mystic","Observer","Pioneer","Guardian","Trickster"],
  "sentiment": one of ["visionary","bullish","conflicted","elegiac","militant","playful","contemplative","defiant"],
  "narrativeArc": one of ["origin","rising","peak","reflection","transformation"] — where is this author in their identity journey?,
  "narrativeNotes": "1 sentence on the identity signal you detected"
}

Rules:
- Be deterministic: same input → same archetype and sentiment.
- title should feel like a gallery exhibition label, not clickbait.
- summary must reveal something about identity, not merely describe the post.
- archetype reflects the author's MODE OF BEING, not the topic.`;

const PATTERN_PROMPT = `You are the Pattern Agent — a data curator for the Imagine on Tezos identity gallery.

You analyze social media posts for thematic patterns, cross-cultural connections, and how they fit into larger movements in the Tezos/Web3 ecosystem.

Given a post (and optionally, the author's prior works), return JSON:
{
  "keywords": ["5-8 thematic keywords — concrete nouns and verbs, not adjectives"],
  "themes": ["2-4 high-level theme labels from: identity, art, governance, finance, technology, community, philosophy, culture"],
  "resonances": ["1-3 short phrases describing connections to broader movements or ideas — e.g. 'digital commons', 'post-platform identity', 'on-chain provenance'"],
  "epochSignal": "shift" | "continuation" | "emergence" — does this post signal a new phase in the author's practice?,
  "patternNotes": "1 sentence on the pattern you detected"
}

Rules:
- keywords should be specific enough to differentiate this post from others.
- themes must map to the 8-label vocabulary above.
- resonances are cultural/philosophical connections, not hashtag descriptions.
- epochSignal: "emergence" for first-time authors, "shift" if themes diverge from prior work, "continuation" if consistent.`;

const SYNTHESIS_PROMPT = `You are the Chief Curator of the Imagine on Tezos identity gallery — a synthesis agent.

Three specialist curators have each analyzed the same social media post. Your job is to synthesize their readings into a SINGLE unified curatorial interpretation.

You receive:
- Chromatic reading (visual/aesthetic)
- Narrative reading (story/meaning)
- Pattern reading (thematic patterns)

Produce a final JSON that merges the best of all three, resolving any conflicts:
{
  "title": "from Narrative agent's title, refined if needed",
  "summary": "2-3 sentence synthesis that weaves visual, narrative, and pattern insights into one museum-quality wall text",
  "archetype": "from Narrative agent",
  "sentiment": "from Narrative agent",
  "keywords": "merged from Pattern + Narrative, deduplicated, 5-6 best",
  "palette": "from Chromatic agent (5 colors)",
  "motionMode": "from Chromatic agent",
  "texture": "from Chromatic agent",
  "visualPrompt": "from Chromatic agent, enriched with narrative context",
  "narrativeArc": "from Narrative agent",
  "resonances": "from Pattern agent",
  "epochSignal": "from Pattern agent",
  "curatorStatement": "1-2 sentence exhibition statement — the kind of text you'd see on a gallery wall next to this work, contextualizing it within the broader #imagineontezos movement"
}

Rules:
- Prefer the specialist's output for their domain (Chromatic for colors, Narrative for archetype, Pattern for keywords).
- Only override a specialist if their output is clearly wrong or inconsistent.
- curatorStatement should add NEW insight, not repeat the summary.
- The final output should feel like it was produced by a curatorial team, not a single AI.`;

// ── Agent runner ────────────────────────────────────────

async function runAgent(systemPrompt, userMsg, label) {
  const start = Date.now();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ],
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error(`${label} returned empty response`);
  const parsed = JSON.parse(raw);
  const ms = Date.now() - start;
  console.log(`[curatorPanel] ${label} completed (${ms}ms)`);
  return parsed;
}

// ── Build user message ──────────────────────────────────

function buildUserMsg(post, priorContext) {
  const lines = [
    `Source: ${post.source || "x"}`,
    post.authorHandle ? `Author: @${post.authorHandle}` : "",
    `Text: ${post.text}`,
    post.hashtags?.length
      ? `Hashtags: ${post.hashtags.map((h) => "#" + h).join(" ")}`
      : "",
  ];

  if (priorContext) {
    lines.push("");
    lines.push("--- Author's prior works ---");
    if (priorContext.archetype)
      lines.push(`Previous archetype: ${priorContext.archetype}`);
    if (priorContext.themes?.length)
      lines.push(`Previous themes: ${priorContext.themes.join(", ")}`);
    if (priorContext.chapterCount != null)
      lines.push(`Chapters so far: ${priorContext.chapterCount}`);
    if (priorContext.epochState)
      lines.push(`Current epoch: ${priorContext.epochState}`);
  }

  return lines.filter(Boolean).join("\n");
}

// ── Main panel function ─────────────────────────────────

/**
 * Run the full curatorial panel on a post.
 * All three agents run in parallel, then the synthesis agent merges them.
 *
 * @param {{ text: string, authorHandle?: string, source?: string, hashtags?: string[] }} post
 * @param {{ archetype?: string, themes?: string[], chapterCount?: number, epochState?: number }} [priorContext]
 * @returns {Promise<object>} Unified curatorial interpretation
 */
async function curateWithPanel(post, priorContext = null) {
  const userMsg = buildUserMsg(post, priorContext);
  const start = Date.now();

  // Run all three agents in parallel
  const [chromatic, narrative, pattern] = await Promise.all([
    runAgent(CHROMATIC_PROMPT, userMsg, "Chromatic Agent"),
    runAgent(NARRATIVE_PROMPT, userMsg, "Narrative Agent"),
    runAgent(PATTERN_PROMPT, userMsg, "Pattern Agent"),
  ]);

  // Synthesize
  const synthesisInput = [
    "=== CHROMATIC READING ===",
    JSON.stringify(chromatic, null, 2),
    "",
    "=== NARRATIVE READING ===",
    JSON.stringify(narrative, null, 2),
    "",
    "=== PATTERN READING ===",
    JSON.stringify(pattern, null, 2),
  ].join("\n");

  const synthesis = await runAgent(
    SYNTHESIS_PROMPT,
    synthesisInput,
    "Chief Curator"
  );

  const totalMs = Date.now() - start;
  console.log(`[curatorPanel] Full panel completed (${totalMs}ms)`);

  // Compute epoch from pattern signal + prior context
  let epochState = priorContext?.epochState || 1;
  if (pattern.epochSignal === "shift") epochState += 1;

  // Build final output in the same shape as interpretPost() for compatibility
  const result = {
    // Core fields (backward compatible with interpretPost)
    title: synthesis.title || narrative.title,
    summary: synthesis.summary || narrative.summary,
    archetype: synthesis.archetype || narrative.archetype,
    sentiment: synthesis.sentiment || narrative.sentiment,
    keywords: synthesis.keywords || pattern.keywords || [],
    palette: synthesis.palette || chromatic.palette || [],
    motionMode: synthesis.motionMode || chromatic.motionMode || "calm",
    visualPrompt: synthesis.visualPrompt || chromatic.visualPrompt,
    epochState,
    traits: [
      { trait_type: "Archetype", value: synthesis.archetype || narrative.archetype },
      { trait_type: "Sentiment", value: synthesis.sentiment || narrative.sentiment },
      { trait_type: "Hashtag", value: "#imagineontezos" },
    ],

    // Enhanced fields from the panel
    texture: synthesis.texture || chromatic.texture,
    narrativeArc: synthesis.narrativeArc || narrative.narrativeArc,
    resonances: synthesis.resonances || pattern.resonances || [],
    epochSignal: pattern.epochSignal || "continuation",
    curatorStatement: synthesis.curatorStatement || null,

    // Agent readings (for transparency / frontend display)
    _panel: {
      chromatic: {
        palette: chromatic.palette,
        motionMode: chromatic.motionMode,
        texture: chromatic.texture,
        visualNotes: chromatic.visualNotes,
      },
      narrative: {
        title: narrative.title,
        archetype: narrative.archetype,
        sentiment: narrative.sentiment,
        narrativeArc: narrative.narrativeArc,
        narrativeNotes: narrative.narrativeNotes,
      },
      pattern: {
        keywords: pattern.keywords,
        themes: pattern.themes,
        resonances: pattern.resonances,
        epochSignal: pattern.epochSignal,
        patternNotes: pattern.patternNotes,
      },
    },
  };

  return result;
}

module.exports = { curateWithPanel };
