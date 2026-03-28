const { decideAndActOnPost } = require("../decideAndActOnPost");
const {
  getLastWorkForHandle,
  saveNewWorkForHandle,
} = require("../identityStore");
const { curatePostWithLLM } = require("../curatePost");
const { generateImageAndMetadata } = require("../imagePipeline");
const { mintNft } = require("../agentMintNft");
const { addChapter } = require("../agentAddChapter");

// 1) Hardcoded fake posts
const FAKE_POSTS = [
  {
    handle: "dorian",
    walletAddress: "0xcc50149446bf9036F9f5aDb6e089a32D458620d7",
    text: "Exploring #imagineontezos as a financial infrastructure for artists.",
  },
  {
    handle: "dorian",
    walletAddress: "0xcc50149446bf9036F9f5aDb6e089a32D458620d7",
    text: "Continuing my Tezos governance obsession, imagining DAOs curating museums. #imagineontezos",
  },
  {
    handle: "dorian",
    walletAddress: "0xcc50149446bf9036F9f5aDb6e089a32D458620d7",
    text: "Switching gears: imagining Tezos as a canvas for generative landscapes. #imagineontezos",
  },
];

async function run() {
  console.log("=== Fake post runner start ===");

  for (const post of FAKE_POSTS) {
    console.log("\n--- Processing post ---");
    console.log("Handle:", post.handle);
    console.log("Text:", post.text);

    const curatedLLM = await curatePostWithLLM(post.text, post.handle);
    console.log("Curation:", curatedLLM.curatorDescription);

    if (curatedLLM.score < 0.6) {
      console.log("Skipping post, low score:", curatedLLM.score);
      continue;
    }

    // Image → IPFS → metadata → IPFS
    const { imageUri, metadataUri } = await generateImageAndMetadata({
      imagePrompt: post.text,
      styleHint: "minimalist line art, Tezos blue/purple",
      handle: post.handle,
      curatorDescription: curatedLLM.curatorDescription,
      themes: curatedLLM.themes,
      tone: curatedLLM.tone,
    });
    console.log("Pinned image:", imageUri);
    console.log("Pinned metadata:", metadataUri);

    const curated = {
      handle: post.handle,
      walletAddress: post.walletAddress,
      rawText: post.text,
      themes: curatedLLM.themes,
      tone: curatedLLM.tone,
      score: curatedLLM.score,
      metadataUri,
      chapterUri: metadataUri,
    };

    const result = await decideAndActOnPost(
      curated,
      getLastWorkForHandle,
      saveNewWorkForHandle,
      mintNft,
      addChapter
    );

    console.log("Decision result:", result);
  }

  console.log("\n=== Fake post runner done ===");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
