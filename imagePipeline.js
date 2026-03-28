const { pinFileBufferToIpfs, pinJsonToIpfs } = require("./pinataClient");

// Placeholder 1x1 PNG. Replace with a real image generation call later.
function fakePngBuffer() {
  const hex =
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907724" +
    "0000000a49444154789c636000000200015e0dd4b20000000049454e44ae426082";
  return Buffer.from(hex, "hex");
}

async function generateImageAndMetadata({
  imagePrompt,
  styleHint,
  handle,
  curatorDescription,
  themes,
  tone,
}) {
  // 1) Get image buffer (stub — swap in diffusion API later)
  const buffer = fakePngBuffer();

  // 2) Upload image to IPFS
  const imagePinned = await pinFileBufferToIpfs(
    buffer,
    `imagineontezos-${handle}.png`
  );

  // 3) Build standard NFT metadata
  const metadata = {
    name: `#imagineontezos – ${handle}`,
    description: curatorDescription,
    image: imagePinned.uri,
    attributes: [
      { trait_type: "handle", value: handle },
      { trait_type: "themes", value: themes.join(", ") },
      { trait_type: "tone", value: tone },
      { trait_type: "prompt", value: imagePrompt },
      { trait_type: "style", value: styleHint },
    ],
  };

  // 4) Upload metadata JSON to IPFS
  const metaPinned = await pinJsonToIpfs(
    metadata,
    `imagineontezos-${handle}-metadata`
  );

  return { imageUri: imagePinned.uri, metadataUri: metaPinned.uri };
}

module.exports = { generateImageAndMetadata };
