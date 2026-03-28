const { decideAndActOnPost } = require("../decideAndActOnPost");
const {
  getLastWorkForHandle,
  saveNewWorkForHandle,
} = require("../identityStore");
const { curatePostWithLLM } = require("../curatePost");
const { generateImageAndMetadata } = require("../imagePipeline");
const { mintNft } = require("../agentMintNft");
const { addChapter } = require("../agentAddChapter");

const TEST_WALLET = "0xcc50149446bf9036F9f5aDb6e089a32D458620d7";

const POSTS = [
  "lol #imagineontezos",
  "Exploring #imagineontezos as financial infrastructure for artists on Tezos.",
  "Continuing to build financial rails for artists on Tezos. #imagineontezos",
  "Artist payments and royalty infrastructure on Tezos keep evolving. #imagineontezos",
  "Imagining Tezos as a canvas for generative landscapes. #imagineontezos",
];

async function run() {
  console.log("=== 5-post E2E dress rehearsal ===\n");

  for (let i = 0; i < POSTS.length; i++) {
    const text = POSTS[i];
    const handle = "dorian";

    console.log(`\n--- Post ${i + 1} / ${POSTS.length} ---`);
    console.log("Text:", text);

    // 1) Curate (deterministic overrides active)
    const curated = await curatePostWithLLM(text, handle);
    console.log("Score:", curated.score, "| Themes:", curated.themes);
    console.log("Curator:", curated.curatorDescription);

    // 2) Skip gate
    if (curated.score < 0.6) {
      console.log(">> SKIPPED (score too low)");
      continue;
    }

    // 3) Image → IPFS → metadata → IPFS
    const { imageUri, metadataUri } = await generateImageAndMetadata({
      imagePrompt: text,
      styleHint: "minimalist line art, Tezos blue/purple",
      handle,
      curatorDescription: curated.curatorDescription,
      themes: curated.themes,
      tone: curated.tone,
    });
    console.log("Pinned image:", imageUri);
    console.log("Pinned metadata:", metadataUri);

    // 4) Decide + act on-chain
    const result = await decideAndActOnPost(
      {
        handle,
        walletAddress: TEST_WALLET,
        rawText: text,
        themes: curated.themes,
        tone: curated.tone,
        score: curated.score,
        metadataUri,
        chapterUri: metadataUri,
      },
      getLastWorkForHandle,
      saveNewWorkForHandle,
      mintNft,
      addChapter
    );

    console.log(">> Result:", result);
  }

  console.log("\n=== Dress rehearsal complete ===");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
