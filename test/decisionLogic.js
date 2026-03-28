const { expect } = require("chai");
const { normalizeThemes, normalizeThemeLabel, clampScore } = require("../curatePost");
const { decideAndActOnPost } = require("../decideAndActOnPost");

describe("Theme normalization", function () {
  it("maps free-text labels to vocabulary", function () {
    expect(normalizeThemeLabel("financial-infrastructure")).to.equal("finance");
    expect(normalizeThemeLabel("DAO")).to.equal("governance");
    expect(normalizeThemeLabel("generative-art")).to.equal("art");
    expect(normalizeThemeLabel("blockchain")).to.equal("tezos");
    expect(normalizeThemeLabel("canvas")).to.equal("landscape");
    expect(normalizeThemeLabel("persona")).to.equal("identity");
    expect(normalizeThemeLabel("random-gibberish")).to.equal("general");
  });

  it("deduplicates after normalization", function () {
    const result = normalizeThemes(["financial-infrastructure", "market", "finance"]);
    expect(result).to.deep.equal(["finance"]);
  });

  it("normalizes mixed themes correctly", function () {
    const result = normalizeThemes(["generative-art", "blockchain", "landscape"]);
    expect(result).to.deep.equal(["art", "tezos", "landscape"]);
  });
});

describe("Score clamping", function () {
  it("clamps low scores to 0.2", function () {
    expect(clampScore(0.05)).to.equal(0.2);
    expect(clampScore(0)).to.equal(0.2);
  });

  it("clamps high scores to 0.95", function () {
    expect(clampScore(1.0)).to.equal(0.95);
    expect(clampScore(0.99)).to.equal(0.95);
  });

  it("passes through mid-range scores", function () {
    expect(clampScore(0.7)).to.equal(0.7);
  });

  it("defaults non-number to 0.5", function () {
    expect(clampScore("bad")).to.equal(0.5);
    expect(clampScore(undefined)).to.equal(0.5);
  });
});

describe("decideAndActOnPost", function () {
  // In-memory store
  let store;
  let mintCalls;
  let chapterCalls;

  function fakeGetLastWork(handle) {
    return Promise.resolve(store[handle] || null);
  }
  function fakeSaveNewWork(handle, work) {
    store[handle] = {
      tokenId: work.tokenId,
      mainThemes: work.mainThemes,
      chapterCount: work.chapterCount,
    };
    return Promise.resolve();
  }
  function fakeMintNft(to, rawText, metadataUri) {
    const call = { to, rawText, metadataUri };
    mintCalls.push(call);
    return Promise.resolve({ tokenId: 100n, txHash: "0xfake_mint_hash" });
  }
  function fakeAddChapter(tokenId, chapterUri) {
    const call = { tokenId, chapterUri };
    chapterCalls.push(call);
    return Promise.resolve({ txHash: "0xfake_chapter_hash", chapterCount: 1 });
  }

  beforeEach(function () {
    store = {};
    mintCalls = [];
    chapterCalls = [];
  });

  it("Case A: skips post when score < 0.6", async function () {
    const curated = {
      handle: "alice",
      walletAddress: "0x1234",
      rawText: "spam post",
      themes: ["general"],
      tone: "neutral",
      score: 0.4,
      metadataUri: "https://example.com/meta.json",
      chapterUri: "https://example.com/ch.json",
    };

    const result = await decideAndActOnPost(curated, fakeGetLastWork, fakeSaveNewWork, fakeMintNft, fakeAddChapter);
    expect(result).to.be.null;
    expect(mintCalls).to.have.length(0);
    expect(chapterCalls).to.have.length(0);
  });

  it("Case B: adds chapter when themes overlap and prior work exists", async function () {
    store["bob"] = {
      tokenId: 42,
      mainThemes: ["finance", "tezos"],
      chapterCount: 0,
    };

    const curated = {
      handle: "bob",
      walletAddress: "0x5678",
      rawText: "more finance on tezos",
      themes: ["finance", "tezos"],
      tone: "reflective",
      score: 0.8,
      metadataUri: "https://example.com/meta.json",
      chapterUri: "https://example.com/ch.json",
    };

    const result = await decideAndActOnPost(curated, fakeGetLastWork, fakeSaveNewWork, fakeMintNft, fakeAddChapter);
    expect(result).to.not.be.null;
    expect(result.action).to.equal("chapter");
    expect(result.tokenId).to.equal(42);
    expect(chapterCalls).to.have.length(1);
    expect(chapterCalls[0].tokenId).to.equal(42);
    expect(mintCalls).to.have.length(0);
    expect(store["bob"].chapterCount).to.equal(1);
  });

  it("Case C: mints new token when themes diverge", async function () {
    store["carol"] = {
      tokenId: 50,
      mainThemes: ["finance"],
      chapterCount: 0,
    };

    const curated = {
      handle: "carol",
      walletAddress: "0xabcd",
      rawText: "beautiful generative landscapes",
      themes: ["landscape"],
      tone: "playful",
      score: 0.8,
      metadataUri: "https://example.com/meta.json",
      chapterUri: "https://example.com/ch.json",
    };

    const result = await decideAndActOnPost(curated, fakeGetLastWork, fakeSaveNewWork, fakeMintNft, fakeAddChapter);
    expect(result).to.not.be.null;
    expect(result.action).to.equal("mint");
    expect(mintCalls).to.have.length(1);
    expect(chapterCalls).to.have.length(0);
    expect(store["carol"].tokenId).to.equal(100n);
    expect(store["carol"].chapterCount).to.equal(0);
  });

  it("Case D: mints new token when no prior work", async function () {
    const curated = {
      handle: "dan",
      walletAddress: "0xdead",
      rawText: "first post about tezos art",
      themes: ["art", "tezos"],
      tone: "hopeful",
      score: 0.9,
      metadataUri: "https://example.com/meta.json",
      chapterUri: "https://example.com/ch.json",
    };

    const result = await decideAndActOnPost(curated, fakeGetLastWork, fakeSaveNewWork, fakeMintNft, fakeAddChapter);
    expect(result.action).to.equal("mint");
    expect(mintCalls).to.have.length(1);
    expect(store["dan"].tokenId).to.equal(100n);
  });

  it("Case E: mints new token when chapters maxed out", async function () {
    store["eve"] = {
      tokenId: 60,
      mainThemes: ["finance", "tezos"],
      chapterCount: 5,
    };

    const curated = {
      handle: "eve",
      walletAddress: "0xbeef",
      rawText: "more finance on tezos again",
      themes: ["finance", "tezos"],
      tone: "intense",
      score: 0.8,
      metadataUri: "https://example.com/meta.json",
      chapterUri: "https://example.com/ch.json",
    };

    const result = await decideAndActOnPost(curated, fakeGetLastWork, fakeSaveNewWork, fakeMintNft, fakeAddChapter);
    expect(result.action).to.equal("mint");
    expect(mintCalls).to.have.length(1);
    expect(chapterCalls).to.have.length(0);
  });
});
