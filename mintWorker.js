const tweetStore = require("./db/tweetStore");
const { pinJsonToIpfs, pinFileBufferToIpfs } = require("./pinataClient");
const { mintNft } = require("./agentMintNft");
const { curateWithPanel } = require("./curatorPanel");
const { renderArtifactHtml } = require("./artifactRenderer");
const { generatePreviewImage } = require("./imagePipeline");
const { getPriorContext, evolveIdentityProfile } = require("./identityStore");

const MINT_INTERVAL = parseInt(process.env.MINT_INTERVAL_MS) || 10000;
const MINT_TO_ADDRESS = process.env.MINT_TO_ADDRESS || process.env.CONTRACT_OWNER_ADDRESS;
const MAX_RETRIES = 3;

let intervalId = null;
let minting = false;

/**
 * Process one eligible tweet: AI interpret → image → HTML → metadata → IPFS → onchain mint.
 * Transitions: eligible → minting → minted | failed
 */
async function processOne(tweet) {
  // Atomically claim this tweet for minting
  if (!tweetStore.markMinting(tweet.tweetId)) {
    return null; // Already claimed by another cycle
  }

  try {
    console.log(`[mintWorker] Processing tweet ${tweet.tweetId} by @${tweet.authorHandle}`);

    const label = tweet.tweetId || `auto-${Date.now()}`;

    // 1. AI interpretation (multi-agent curatorial panel)
    console.log(`[mintWorker] Running curatorial panel…`);
    const priorContext = tweet.authorHandle
      ? await getPriorContext(tweet.authorHandle)
      : null;
    const ai = await curateWithPanel(tweet, priorContext);

    // 2. Generate preview image
    console.log(`[mintWorker] Generating preview image…`);
    const { uri: imageUri } = await generatePreviewImage(
      ai.visualPrompt,
      ai.palette,
      label
    );

    // 3. Generate HTML artifact
    console.log(`[mintWorker] Rendering HTML artifact…`);
    const sourcePost = {
      url: tweet.url || tweet.tweetUrl || "",
      text: tweet.text,
      username: tweet.authorHandle || null,
      created_at: tweet.createdAt || null,
    };
    const html = renderArtifactHtml({ sourcePost, ai });
    const htmlBuffer = Buffer.from(html, "utf-8");
    const { uri: animationUri } = await pinFileBufferToIpfs(
      htmlBuffer,
      `imagineontezos-${label}-artifact.html`
    );

    // 4. Build 3-layer metadata
    const metadata = buildMetadata(tweet, ai, imageUri, animationUri);

    // 5. Pin metadata to IPFS
    const pinName = `imagineontezos-${label}-metadata`;
    const { uri: tokenURI } = await pinJsonToIpfs(metadata, pinName);
    console.log(`[mintWorker] Pinned metadata: ${tokenURI}`);

    // 6. Mint onchain
    const recipient = MINT_TO_ADDRESS;
    if (!recipient) {
      throw new Error("No MINT_TO_ADDRESS or CONTRACT_OWNER_ADDRESS configured");
    }

    const { txHash, tokenId } = await mintNft(recipient, tweet.text, tokenURI);
    console.log(`[mintWorker] Minted token #${tokenId} tx=${txHash}`);

    // 7. Record success
    tweetStore.markMinted(tweet.tweetId, {
      mintedTokenId: tokenId.toString(),
      mintTxHash: txHash,
      tokenURI,
    });

    // 8. Evolve identity profile
    if (tweet.authorHandle) {
      await evolveIdentityProfile(tweet.authorHandle, ai, "mint");
      console.log(`[mintWorker] Evolved identity for @${tweet.authorHandle}`);
    }

    return { tweetId: tweet.tweetId, tokenId: tokenId.toString(), txHash };
  } catch (err) {
    console.error(`[mintWorker] Failed to mint tweet ${tweet.tweetId}:`, err.message);
    tweetStore.markFailed(tweet.tweetId, err.message);
    return null;
  }
}

/**
 * Run one mint cycle — process up to one eligible tweet at a time.
 */
async function mintOnce() {
  if (minting) return;
  minting = true;

  try {
    const eligible = tweetStore.getByStatus("eligible");
    if (eligible.length === 0) return;

    // Filter out tweets that exceeded max retries
    const candidate = eligible.find((t) => t.retryCount < MAX_RETRIES);
    if (!candidate) {
      console.log("[mintWorker] All eligible tweets have exceeded max retries");
      return;
    }

    await processOne(candidate);
  } catch (err) {
    console.error("[mintWorker] Cycle error:", err.message);
  } finally {
    minting = false;
  }
}

/**
 * Build 3-layer NFT metadata from a tweet + AI interpretation.
 */
function buildMetadata(tweet, ai, imageUri, animationUri) {
  const source = tweet.source || "x";
  const sourceLabel = source === "farcaster" ? "Farcaster" : "X";
  const authorPrefix = source === "farcaster" ? "" : "@";
  const author = tweet.authorHandle || "anonymous";

  return {
    name: ai.title || `Imagine Identity — ${authorPrefix}${author}`,
    description: ai.summary || tweet.text,
    external_url: tweet.url || "",
    image: imageUri,
    animation_url: animationUri,
    attributes: [
      ...(ai.traits || []),
      { trait_type: "Source", value: sourceLabel },
      { trait_type: "Author", value: `${authorPrefix}${author}` },
      { trait_type: "Motion", value: ai.motionMode || "calm" },
      { trait_type: "Epoch", display_type: "number", value: ai.epochState || 1 },
      ...(Array.isArray(ai.keywords) ? ai.keywords : typeof ai.keywords === "string" ? ai.keywords.split(/,\s*/) : []).map((k) => ({ trait_type: "Keyword", value: k })),
      ...(tweet.hashtags || [])
        .filter((h) => h.toLowerCase() !== "imagineontezos")
        .map((h) => ({ trait_type: "Tag", value: `#${h}` })),
    ],
    sourcePost: {
      url: tweet.url || "",
      text: tweet.text,
      username: tweet.authorHandle || null,
      created_at: tweet.createdAt || null,
      source,
    },
    ai: {
      title: ai.title,
      summary: ai.summary,
      archetype: ai.archetype,
      sentiment: ai.sentiment,
      keywords: ai.keywords,
      palette: ai.palette,
      motionMode: ai.motionMode,
      visualPrompt: ai.visualPrompt,
      epochState: ai.epochState || 1,
      // Enhanced panel fields
      texture: ai.texture || null,
      narrativeArc: ai.narrativeArc || null,
      resonances: ai.resonances || [],
      curatorStatement: ai.curatorStatement || null,
      _panel: ai._panel || null,
    },
  };
}

/**
 * Start the auto-mint worker.
 */
function start() {
  if (process.env.ENABLE_AUTO_MINT !== "true") {
    console.log("[mintWorker] Auto-mint disabled (set ENABLE_AUTO_MINT=true to enable)");
    return;
  }

  if (intervalId) {
    console.log("[mintWorker] Already running");
    return;
  }

  if (!MINT_TO_ADDRESS) {
    console.error("[mintWorker] MINT_TO_ADDRESS or CONTRACT_OWNER_ADDRESS required");
    return;
  }

  console.log(`[mintWorker] Starting — checking every ${MINT_INTERVAL / 1000}s`);
  mintOnce();
  intervalId = setInterval(mintOnce, MINT_INTERVAL);
}

/**
 * Stop the auto-mint worker.
 */
function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[mintWorker] Stopped");
  }
}

function isRunning() {
  return intervalId !== null;
}

module.exports = { start, stop, isRunning, mintOnce };
