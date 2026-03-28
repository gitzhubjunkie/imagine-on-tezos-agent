// Very dumb similarity: Jaccard over theme tags
function themeSimilarity(a, b) {
  const setA = new Set(a.map((t) => t.toLowerCase()));
  const setB = new Set(b.map((t) => t.toLowerCase()));
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return 0;
  return inter / union;
}

const MAX_CHAPTERS_PER_TOKEN = 5;
const SIMILARITY_THRESHOLD = 0.4;

/**
 * Decide whether to mint a new token or add a chapter to an existing one.
 *
 * @param {Object} curated - The curated post data.
 * @param {string} curated.handle - User handle.
 * @param {string} curated.walletAddress - Recipient wallet address.
 * @param {string} curated.rawText - Original post text (used for prompt hash).
 * @param {string[]} curated.themes - Extracted themes, e.g. ["finance", "ai"].
 * @param {string} curated.tone - Tone label, e.g. "hopeful".
 * @param {number} curated.score - Curation score (0-1).
 * @param {string} curated.metadataUri - URI of full metadata JSON.
 * @param {string} [curated.chapterUri] - Optional URI for chapter-only metadata.
 * @param {function} getLastWorkForHandle - async (handle) => LastWork | null
 * @param {function} saveNewWorkForHandle - async (handle, work) => void
 * @param {function} mintNft - async (to, rawText, metadataUri) => {tokenId, txHash}
 * @param {function} addChapter - async (tokenId, chapterUri) => {txHash}
 * @returns {Promise<{action: string, tokenId: number|bigint, txHash: string} | null>}
 */
async function decideAndActOnPost(
  curated,
  getLastWorkForHandle,
  saveNewWorkForHandle,
  mintNft,
  addChapter
) {
  // Guardrail: skip low-score posts
  if (curated.score < 0.6) {
    console.log("Skip mint: score too low", curated.score);
    return null;
  }

  const lastWork = await getLastWorkForHandle(curated.handle);

  // CASE 1: no previous work → mint new token
  if (!lastWork) {
    console.log("No previous work; minting new token");
    const { tokenId, txHash } = await mintNft(
      curated.walletAddress,
      curated.rawText,
      curated.metadataUri
    );
    await saveNewWorkForHandle(curated.handle, {
      tokenId,
      mainThemes: curated.themes,
      chapterCount: 0,
    });
    return { action: "mint", tokenId, txHash };
  }

  // Compute thematic similarity
  const sim = themeSimilarity(curated.themes, lastWork.mainThemes);
  const canAppendChapter =
    sim >= SIMILARITY_THRESHOLD &&
    lastWork.chapterCount < MAX_CHAPTERS_PER_TOKEN;

  if (canAppendChapter && curated.chapterUri) {
    console.log(
      `Adding chapter to token ${lastWork.tokenId} (sim=${sim.toFixed(2)})`
    );
    const res = await addChapter(lastWork.tokenId, curated.chapterUri);
    // Increment local chapter count
    await saveNewWorkForHandle(curated.handle, {
      tokenId: lastWork.tokenId,
      mainThemes: lastWork.mainThemes,
      chapterCount: lastWork.chapterCount + 1,
    });
    return { action: "chapter", tokenId: lastWork.tokenId, txHash: res.txHash };
  }

  // OTHERWISE: new token (new "period")
  console.log(
    `Minting new token: sim=${sim.toFixed(2)}, chapters=${lastWork.chapterCount}`
  );
  const { tokenId, txHash } = await mintNft(
    curated.walletAddress,
    curated.rawText,
    curated.metadataUri
  );
  await saveNewWorkForHandle(curated.handle, {
    tokenId,
    mainThemes: curated.themes,
    chapterCount: 0,
  });
  return { action: "mint", tokenId, txHash };
}

// Example CLI run with SQLite-backed store
if (require.main === module) {
  const {
    getLastWorkForHandle,
    saveNewWorkForHandle,
  } = require("./identityStore");
  const { mintNft } = require("./agentMintNft");
  const { addChapter } = require("./agentAddChapter");

  const curated = {
    handle: "testuser",
    walletAddress: "0xcc50149446bf9036F9f5aDb6e089a32D458620d7",
    rawText: "exploring new identity patterns on tezos",
    themes: ["identity", "tezos", "art"],
    tone: "hopeful",
    score: 0.85,
    metadataUri: "https://example.com/metadata/test.json",
    chapterUri: "https://example.com/chapters/test-ch1.json",
  };

  (async () => {
    // First call: should mint (no previous work)
    const result1 = await decideAndActOnPost(
      curated,
      getLastWorkForHandle,
      saveNewWorkForHandle,
      mintNft,
      addChapter
    );
    console.log("Result 1:", result1);

    // Second call with similar themes: should add chapter
    const curated2 = {
      ...curated,
      rawText: "continuing identity exploration on tezos",
      themes: ["identity", "tezos", "philosophy"],
      chapterUri: "https://example.com/chapters/test-ch2.json",
    };
    const result2 = await decideAndActOnPost(
      curated2,
      getLastWorkForHandle,
      saveNewWorkForHandle,
      mintNft,
      addChapter
    );
    console.log("Result 2:", result2);

    // Third call with different themes: should mint new
    const curated3 = {
      ...curated,
      rawText: "beach sunset photography",
      themes: ["nature", "photography", "travel"],
    };
    const result3 = await decideAndActOnPost(
      curated3,
      getLastWorkForHandle,
      saveNewWorkForHandle,
      mintNft,
      addChapter
    );
    console.log("Result 3:", result3);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { decideAndActOnPost, themeSimilarity };
