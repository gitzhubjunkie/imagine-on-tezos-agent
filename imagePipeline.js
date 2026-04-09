const { openai } = require("./llmClient");
const { pinFileBufferToIpfs, pinJsonToIpfs } = require("./pinataClient");
const axios = require("axios");

/**
 * Generate a preview image from an AI visual prompt using DALL-E 3.
 * Falls back to a colored placeholder if image generation fails.
 * @param {string} visualPrompt - The AI-generated image prompt
 * @param {string[]} palette - Hex color palette from AI interpretation
 * @param {string} label - Label for IPFS pin name
 * @returns {Promise<{ uri: string, buffer: Buffer }>}
 */
async function generatePreviewImage(visualPrompt, palette = [], label = "artifact") {
  let buffer;

  try {
    const res = await openai.images.generate({
      model: "dall-e-3",
      prompt: `Abstract digital art, minimal and geometric. ${visualPrompt} Color palette: ${palette.slice(0, 3).join(", ")}. No text, no words, no letters, no watermarks.`,
      n: 1,
      size: "1024x1024",
      response_format: "url",
    });

    const imageUrl = res.data[0]?.url;
    if (!imageUrl) throw new Error("No image URL returned");

    const download = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 });
    buffer = Buffer.from(download.data);
    console.log(`[imagePipeline] Generated DALL-E image (${buffer.length} bytes)`);
  } catch (err) {
    console.warn(`[imagePipeline] DALL-E failed (${err.message}), using placeholder`);
    buffer = generateColorPlaceholder(palette);
  }

  const pinned = await pinFileBufferToIpfs(buffer, `imagineontezos-${label}.png`);
  return { uri: pinned.uri, buffer };
}

/**
 * Generate a simple SVG-based placeholder using the palette colors.
 * Returns a PNG-compatible buffer (actually SVG but renderable).
 */
function generateColorPlaceholder(palette = ["#0F172A", "#14B8A6", "#F8FAFC"]) {
  const bg = palette[0] || "#0F172A";
  const accent = palette[1] || "#14B8A6";
  const light = palette[2] || "#F8FAFC";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${bg}"/>
  <circle cx="512" cy="420" r="180" fill="none" stroke="${accent}" stroke-width="2" opacity="0.6"/>
  <circle cx="512" cy="420" r="80" fill="${accent}" opacity="0.15"/>
  <rect x="312" y="680" width="400" height="2" fill="${accent}" opacity="0.4"/>
  <text x="512" y="740" text-anchor="middle" font-family="monospace" font-size="14" fill="${light}" opacity="0.3">IMAGINE ON TEZOS</text>
</svg>`;

  return Buffer.from(svg, "utf-8");
}

// Keep old export for backward compat
async function generateImageAndMetadata({
  imagePrompt,
  styleHint,
  handle,
  curatorDescription,
  themes,
  tone,
}) {
  const { uri: imageUri } = await generatePreviewImage(
    `${imagePrompt} Style: ${styleHint}`,
    ["#0F172A", "#14B8A6", "#F8FAFC"],
    handle
  );

  const metadata = {
    name: `#imagineontezos – ${handle}`,
    description: curatorDescription,
    image: imageUri,
    attributes: [
      { trait_type: "handle", value: handle },
      { trait_type: "themes", value: themes.join(", ") },
      { trait_type: "tone", value: tone },
      { trait_type: "prompt", value: imagePrompt },
      { trait_type: "style", value: styleHint },
    ],
  };

  const metaPinned = await pinJsonToIpfs(
    metadata,
    `imagineontezos-${handle}-metadata`
  );

  return { imageUri, metadataUri: metaPinned.uri };
}

module.exports = { generatePreviewImage, generateImageAndMetadata };
