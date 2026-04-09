require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { parseTweetId, lookupTweet, searchHashtag } = require("./xClient");
const { pinJsonToIpfs, pinFileBufferToIpfs } = require("./pinataClient");
const { mintNft } = require("./agentMintNft");
const tweetStore = require("./db/tweetStore");
const scheduler = require("./scheduler");
const farcasterScheduler = require("./farcasterScheduler");
const { lookupCast, parseWarpcastUrl } = require("./farcasterClient");
const mintWorker = require("./mintWorker");
const { interpretPost } = require("./aiInterpreter");
const { curateWithPanel } = require("./curatorPanel");
const { renderArtifactHtml } = require("./artifactRenderer");
const { generatePreviewImage } = require("./imagePipeline");
const { getPriorContext, evolveIdentityProfile, getIdentityProfile } = require("./identityStore");
const { generateWallText } = require("./wallTextGenerator");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.API_PORT || 3001;
const REQUIRED_HASHTAG = "imagineontezos";

// ── Health ──────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  await res.json({ ok: true });
});

// ── Resolve tweet ───────────────────────────────────────
// POST /api/resolve-tweet  { tweetUrl: "https://x.com/.../status/123" }
// or                       { tweetId: "123" }
app.post("/api/resolve-tweet", async (req, res) => {
  try {
    const { tweetUrl, tweetId: rawId } = req.body || {};

    let tweetId = rawId;
    let url = tweetUrl;
    if (tweetUrl) {
      tweetId = parseTweetId(tweetUrl);
      if (!tweetId) {
        res.status(400).json({ error: "Invalid X/Twitter URL — expected https://x.com/{user}/status/{id}" });
        return;
      }
    }
    if (!tweetId) {
      res.status(400).json({ error: "Provide tweetUrl or tweetId" });
      return;
    }

    // lookupTweet uses oEmbed first (no auth), v2 as fallback
    const tweet = await lookupTweet(tweetId, url);

    if (!tweet || !tweet.text) {
      res.status(404).json({ error: "Tweet not found or has no text content" });
      return;
    }

    // Validate hashtag
    const hasTag = (tweet.hashtags || []).some(
      (h) => h.toLowerCase() === REQUIRED_HASHTAG
    );
    if (!hasTag) {
      res.status(400).json({
        error: `Tweet must include #${REQUIRED_HASHTAG}`,
      });
      return;
    }

    res.json({ tweet });
  } catch (err) {
    console.error("resolve-tweet error:", err.message);
    const status = err.response?.status || 500;
    const msg = err.response?.data?.detail || err.response?.data?.title || err.message;
    res.status(status).json({ error: msg || "Failed to fetch tweet" });
  }
});

// ── Search #imagineontezos ──────────────────────────────
// GET /api/search-imagine?limit=10
app.get("/api/search-imagine", async (req, res) => {
  try {
    if (!process.env.X_BEARER_TOKEN) {
      await res.status(503).json({ error: "Server misconfigured: X_BEARER_TOKEN is not set." });
      return;
    }
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const tweets = await searchHashtag(REQUIRED_HASHTAG, limit);
    await res.json({ tweets });
  } catch (err) {
    console.error("search-imagine error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Build + pin metadata ────────────────────────────────
// POST /api/metadata  { tweet: {...} }
// Returns { tokenURI, metadata }
app.post("/api/metadata", async (req, res) => {
  try {
    const { tweet } = req.body;
    if (!tweet || !tweet.text) {
      await res.status(400).json({ error: "Tweet data required" });
      return;
    }

    const metadata = buildMetadataLegacy(tweet);
    const pinName = tweet.tweetId
      ? `imagineontezos-tweet-${tweet.tweetId}`
      : `imagineontezos-manual-${Date.now()}`;
    const { uri: tokenURI } = await pinJsonToIpfs(metadata, pinName);

    await res.json({ tokenURI, metadata });
  } catch (err) {
    console.error("metadata error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── AI Interpretation (multi-agent panel) ───────────────
// POST /api/interpret-post  { post: { text, authorHandle?, source?, hashtags? }, useLegacy?: bool }
// Returns { interpretation: { title, summary, archetype, ..., _panel? } }
app.post("/api/interpret-post", async (req, res) => {
  try {
    const { post, useLegacy } = req.body;
    if (!post || !post.text) {
      await res.status(400).json({ error: "Post data with text required" });
      return;
    }

    if (useLegacy) {
      const interpretation = await interpretPost(post);
      await res.json({ interpretation });
      return;
    }

    // Multi-agent curatorial panel with prior identity context
    const priorContext = post.authorHandle
      ? await getPriorContext(post.authorHandle)
      : null;
    const interpretation = await curateWithPanel(post, priorContext);
    await res.json({ interpretation });
  } catch (err) {
    console.error("interpret-post error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Full dynamic mint pipeline ──────────────────────────
// POST /api/dynamic-mint  { tweet: {...}, walletAddress: "0x..." }
// Runs: AI interpret → image gen → HTML artifact → IPFS pin → onchain mint
app.post("/api/dynamic-mint", async (req, res) => {
  try {
    const { tweet, walletAddress } = req.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      await res.status(400).json({ error: "Invalid wallet address" });
      return;
    }
    if (!tweet || !tweet.text) {
      await res.status(400).json({ error: "Tweet data required" });
      return;
    }

    const label = tweet.tweetId || `manual-${Date.now()}`;

    // 1. AI interpretation (multi-agent panel)
    console.log(`[dynamic-mint] Running curatorial panel for ${label}…`);
    const priorContext = tweet.authorHandle
      ? await getPriorContext(tweet.authorHandle)
      : null;
    const ai = await curateWithPanel(tweet, priorContext);

    // 2. Generate preview image
    console.log(`[dynamic-mint] Generating preview image…`);
    const { uri: imageUri } = await generatePreviewImage(
      ai.visualPrompt,
      ai.palette,
      label
    );

    // 3. Generate HTML artifact
    console.log(`[dynamic-mint] Rendering HTML artifact…`);
    const sourcePost = {
      url: tweet.tweetUrl || tweet.url || "",
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
    const metadata = build3LayerMetadata({ tweet, ai, imageUri, animationUri });

    // 5. Pin metadata
    const { uri: tokenURI } = await pinJsonToIpfs(
      metadata,
      `imagineontezos-${label}-metadata`
    );
    console.log(`[dynamic-mint] Pinned metadata: ${tokenURI}`);

    // 6. Mint onchain
    const { txHash, tokenId } = await mintNft(walletAddress, tweet.text, tokenURI);
    console.log(`[dynamic-mint] Minted token #${tokenId} tx=${txHash}`);

    // 7. Evolve identity profile
    if (tweet.authorHandle) {
      await evolveIdentityProfile(tweet.authorHandle, ai, "mint");
      console.log(`[dynamic-mint] Evolved identity for @${tweet.authorHandle}`);
    }

    await res.json({
      tokenId: tokenId.toString(),
      txHash,
      tokenURI,
      imageUri,
      animationUri,
      interpretation: ai,
      metadata,
    });
  } catch (err) {
    console.error("Dynamic mint error:", err.message);
    await res.status(500).json({ error: `Mint failed: ${err.message}` });
  }
});

// ── Legacy mint (no AI) ─────────────────────────────────
// POST /api/mint  { tweet: {...}, walletAddress: "0x..." }
app.post("/api/mint", async (req, res) => {
  try {
    const { tweet, walletAddress } = req.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      await res.status(400).json({ error: "Invalid wallet address" });
      return;
    }
    if (!tweet || !tweet.text) {
      await res.status(400).json({ error: "Tweet data required" });
      return;
    }

    // 1. Build NFT metadata
    const metadata = buildMetadataLegacy(tweet);

    // 2. Pin metadata to IPFS
    const pinName = tweet.tweetId
      ? `imagineontezos-tweet-${tweet.tweetId}`
      : `imagineontezos-manual-${Date.now()}`;
    const { uri: tokenURI } = await pinJsonToIpfs(metadata, pinName);
    console.log("Pinned metadata:", tokenURI);

    // 3. Mint onchain — owner key mints, recipient is walletAddress
    const { txHash, tokenId } = await mintNft(
      walletAddress,
      tweet.text,
      tokenURI
    );

    await res.json({
      tokenId: tokenId.toString(),
      txHash,
      tokenURI,
      metadata,
    });
  } catch (err) {
    console.error("Mint error:", err.message);
    await res.status(500).json({ error: `Mint failed: ${err.message}` });
  }
});

// ── 3-layer metadata builder ────────────────────────────
function build3LayerMetadata({ tweet, ai, imageUri, animationUri }) {
  const source = tweet.source || "x";
  const sourceLabel = source === "farcaster" ? "Farcaster" : "X";
  const authorPrefix = source === "farcaster" ? "" : "@";
  const author = tweet.authorHandle || "anonymous";

  return {
    name: ai.title || `Imagine Identity — ${authorPrefix}${author}`,
    description: ai.summary || tweet.text,
    external_url: tweet.tweetUrl || tweet.url || "",
    image: imageUri,
    animation_url: animationUri,
    attributes: [
      ...(ai.traits || []),
      { trait_type: "Source", value: sourceLabel },
      { trait_type: "Author", value: `${authorPrefix}${author}` },
      { trait_type: "Motion", value: ai.motionMode || "calm" },
      { trait_type: "Epoch", display_type: "number", value: ai.epochState || 1 },
      ...(ai.keywords || []).map((k) => ({ trait_type: "Keyword", value: k })),
      ...(tweet.hashtags || [])
        .filter((h) => h.toLowerCase() !== "imagineontezos")
        .map((h) => ({ trait_type: "Tag", value: `#${h}` })),
    ],
    sourcePost: {
      url: tweet.tweetUrl || tweet.url || "",
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
      // Enhanced fields from curatorial panel
      texture: ai.texture || null,
      narrativeArc: ai.narrativeArc || null,
      resonances: ai.resonances || [],
      curatorStatement: ai.curatorStatement || null,
      _panel: ai._panel || null,
    },
  };
}

// ── Legacy metadata builder ─────────────────────────────
function buildMetadataLegacy(tweet) {
  const t = tweet;
  return {
    name: t.authorHandle
      ? `Imagine on Tezos — @${t.authorHandle}`
      : `Imagine on Tezos — ${t.text.slice(0, 40)}`,
    description: t.text,
    external_url: t.tweetUrl || "",
    image: t.imageUrl || "",
    attributes: [
      { trait_type: "Source", value: t.tweetUrl ? "X" : "manual" },
      { trait_type: "Hashtag", value: "#imagineontezos" },
      { trait_type: "Author", value: t.authorHandle ? `@${t.authorHandle}` : "anonymous" },
      ...(t.hashtags || [])
        .filter((h) => h.toLowerCase() !== REQUIRED_HASHTAG)
        .map((h) => ({ trait_type: "tag", value: h })),
    ],
    tweet: {
      id: t.tweetId || null,
      url: t.tweetUrl || null,
      text: t.text,
      username: t.authorHandle || null,
      created_at: t.createdAt || null,
      media: (t.media || []).map((m) => m.url || m),
    },
  };
}

// ── Global error handler ────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ── Pipeline tweets list ────────────────────────────────
// GET /api/tweets?status=eligible&source=farcaster&limit=50&offset=0
app.get("/api/tweets", async (req, res) => {
  try {
    const { status, source, limit, offset } = req.query;
    let tweets;
    if (status && source) {
      tweets = tweetStore.getByStatusAndSource(status, source);
    } else if (status) {
      tweets = tweetStore.getByStatus(status);
    } else {
      tweets = tweetStore.getAll(
        Math.min(parseInt(limit) || 50, 200),
        parseInt(offset) || 0,
        source || null
      );
    }
    await res.json({ tweets });
  } catch (err) {
    console.error("tweets error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Single tweet status ─────────────────────────────────
// GET /api/tweets/:tweetId
app.get("/api/tweets/:tweetId", async (req, res) => {
  try {
    const tweet = tweetStore.getById(req.params.tweetId);
    if (!tweet) {
      await res.status(404).json({ error: "Tweet not found" });
      return;
    }
    await res.json({ tweet });
  } catch (err) {
    console.error("tweet-by-id error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Pipeline stats ──────────────────────────────────────
// GET /api/stats
app.get("/api/stats", async (_req, res) => {
  try {
    const stats = tweetStore.getStats();
    stats.schedulerRunning = scheduler.isRunning();
    stats.fcSchedulerRunning = farcasterScheduler.isRunning();
    stats.mintWorkerRunning = mintWorker.isRunning();
    stats.autoMintEnabled = process.env.ENABLE_AUTO_MINT === "true";
    await res.json(stats);
  } catch (err) {
    console.error("stats error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Manual ingest trigger ───────────────────────────────
// POST /api/ingest
app.post("/api/ingest", async (_req, res) => {
  try {
    const result = await scheduler.ingestOnce();
    await res.json(result);
  } catch (err) {
    console.error("ingest error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Farcaster manual ingest ─────────────────────────────
// POST /api/ingest-farcaster
app.post("/api/ingest-farcaster", async (_req, res) => {
  try {
    const result = await farcasterScheduler.ingestOnce();
    await res.json(result);
  } catch (err) {
    console.error("fc-ingest error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Resolve Farcaster cast ──────────────────────────────
// POST /api/resolve-cast  { castUrl: "https://warpcast.com/user/0xabc..." }
app.post("/api/resolve-cast", async (req, res) => {
  try {
    const { castUrl } = req.body;
    if (!castUrl || !castUrl.includes("warpcast.com")) {
      await res.status(400).json({ error: "Provide a valid Warpcast URL" });
      return;
    }

    const cast = await lookupCast(castUrl, "url");

    const hasTag = (cast.hashtags || []).some(
      (h) => h.toLowerCase() === REQUIRED_HASHTAG
    );
    if (!hasTag) {
      await res.status(400).json({ error: `Cast must include #${REQUIRED_HASHTAG}` });
      return;
    }

    await res.json({ cast });
  } catch (err) {
    console.error("resolve-cast error:", err.message);
    const status = err.response?.status || 500;
    await res.status(status).json({ error: err.message });
  }
});

// ── Retry a failed tweet ────────────────────────────────
// POST /api/tweets/:tweetId/retry
app.post("/api/tweets/:tweetId/retry", async (req, res) => {
  try {
    const ok = tweetStore.resetFailed(req.params.tweetId);
    if (!ok) {
      await res.status(400).json({ error: "Tweet is not in failed state" });
      return;
    }
    await res.json({ ok: true });
  } catch (err) {
    console.error("retry error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Identity profile ────────────────────────────────────
// GET /api/identity/:handle — get full evolving identity profile + wall text
app.get("/api/identity/:handle", async (req, res) => {
  try {
    const profile = await getIdentityProfile(req.params.handle);
    if (!profile) {
      await res.status(404).json({ error: "No identity profile found" });
      return;
    }
    await res.json({ handle: req.params.handle, profile });
  } catch (err) {
    console.error("identity error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Wall text generator ─────────────────────────────────
// GET /api/identity/:handle/wall-text — generate exhibition wall text
app.get("/api/identity/:handle/wall-text", async (req, res) => {
  try {
    const profile = await getIdentityProfile(req.params.handle);
    if (!profile) {
      await res.status(404).json({ error: "No identity profile found" });
      return;
    }
    const wallText = await generateWallText(req.params.handle, profile);
    await res.json({ handle: req.params.handle, ...wallText });
  } catch (err) {
    console.error("wall-text error:", err.message);
    await res.status(500).json({ error: err.message });
  }
});

// ── Catch-all error handler ─────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);

  // Start ingestion schedulers
  scheduler.start();
  farcasterScheduler.start();

  // Start auto-mint worker
  mintWorker.start();
});
