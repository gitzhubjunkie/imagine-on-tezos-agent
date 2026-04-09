const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ImagineOnTezosIdentity", function () {
  let contract;
  let owner;
  let addr1;
  let agent;

  beforeEach(async () => {
    [owner, addr1, agent] = await ethers.getSigners();

    const Imagine = await ethers.getContractFactory("ImagineOnTezosIdentity");
    contract = await Imagine.deploy(
      "ImagineOnTezosIdentity",
      "IMAGINE"
    );
    await contract.waitForDeployment();

    // Set agent
    const agentTx = await contract.setAgent(agent.address);
    await agentTx.wait();
  });

  it("deploys with correct owner", async () => {
    const contractOwner = await contract.owner();
    expect(contractOwner).to.equal(owner.address);
  });

  it("mints and stores mappings correctly", async () => {
    const prompt = ethers.keccak256(ethers.toUtf8Bytes("test prompt"));
    const uri = "https://gateway.pinata.cloud/ipfs/Qm123";

    const tx = await contract.mintTo(addr1.address, uri, prompt);
    await tx.wait();

    // tokenId should start at 0
    const promptStored = await contract.promptHash(0);
    const authorStored = await contract.originalAuthor(0);

    expect(promptStored).to.equal(prompt);
    expect(authorStored).to.equal(addr1.address);

    // ownerOf should be addr1
    const nftOwner = await contract.ownerOf(0);
    expect(nftOwner).to.equal(addr1.address);

    // tokenURI should return the per-token URI
    const storedUri = await contract.tokenURI(0);
    expect(storedUri).to.equal(uri);
  });

  it("only owner can mint", async () => {
    const prompt = ethers.keccak256(ethers.toUtf8Bytes("test prompt"));
    await expect(
      contract.connect(addr1).mintTo(addr1.address, "ignored-uri", prompt)
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });

  it("sets agent correctly", async () => {
    const currentAgent = await contract.agent();
    expect(currentAgent).to.equal(agent.address);
  });

  it("only owner can set agent", async () => {
    await expect(
      contract.connect(addr1).setAgent(addr1.address)
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });

  it("agent can add chapters to minted token", async () => {
    // First mint a token
    const prompt = ethers.keccak256(ethers.toUtf8Bytes("test prompt"));
    const mintTx = await contract.mintTo(addr1.address, "ignored-uri", prompt);
    await mintTx.wait();

    // Then agent adds a chapter
    const chapterURI = "https://example.com/chapter-1";
    const chapterTx = await contract.connect(agent).addChapter(0, chapterURI);
    await chapterTx.wait();

    // Verify chapter was added
    const count = await contract.getChapterCount(0);
    expect(count).to.equal(1);
    const stored = await contract.getChapter(0, 0);
    expect(stored).to.equal(chapterURI);
  });

  it("non-agent cannot add chapters", async () => {
    // First mint a token
    const prompt = ethers.keccak256(ethers.toUtf8Bytes("test prompt"));
    const mintTx = await contract.mintTo(addr1.address, "ignored-uri", prompt);
    await mintTx.wait();

    // Try to add chapter as non-agent
    const chapterURI = "https://example.com/chapter-1";
    await expect(
      contract.connect(addr1).addChapter(0, chapterURI)
    ).to.be.revertedWith("only agent");
  });

  it("multiple chapters can be added to same token", async () => {
    // First mint a token
    const prompt = ethers.keccak256(ethers.toUtf8Bytes("test prompt"));
    const mintTx = await contract.mintTo(addr1.address, "ignored-uri", prompt);
    await mintTx.wait();

    // Add multiple chapters
    const chapter1 = "https://example.com/chapter-1";
    const chapter2 = "https://example.com/chapter-2";
    const chapter3 = "https://example.com/chapter-3";

    await contract.connect(agent).addChapter(0, chapter1);
    await contract.connect(agent).addChapter(0, chapter2);
    await contract.connect(agent).addChapter(0, chapter3);

    // Verify all chapters were added
    const count = await contract.getChapterCount(0);
    expect(count).to.equal(3);
    expect(await contract.getChapter(0, 0)).to.equal(chapter1);
    expect(await contract.getChapter(0, 1)).to.equal(chapter2);
    expect(await contract.getChapter(0, 2)).to.equal(chapter3);
  });

  it("allows owner to set agent and agent to add chapters", async () => {
    const [owner, addr1, agent] = await ethers.getSigners();

    // redeploy with 3 signers to have a distinct agent
    const Imagine = await ethers.getContractFactory("ImagineOnTezosIdentity");
    const freshContract = await Imagine.deploy(
      "ImagineOnTezosIdentity",
      "IMAGINE"
    );
    await freshContract.waitForDeployment();

    // mint tokenId 0 to addr1
    const prompt = ethers.keccak256(ethers.toUtf8Bytes("chapter test"));
    await freshContract.mintTo(addr1.address, "ignored-uri", prompt);

    // set agent
    await freshContract.setAgent(agent.address);
    expect(await freshContract.agent()).to.equal(agent.address);

    // non-agent cannot addChapter
    await expect(
      freshContract.addChapter(0, "https://example.com/chapter/1.json")
    ).to.be.revertedWith("only agent");

    // agent can addChapter
    const contractAsAgent = freshContract.connect(agent);
    await contractAsAgent.addChapter(0, "https://example.com/chapter/1.json");

    const count = await freshContract.getChapterCount(0);
    expect(count).to.equal(1);

    const stored = await freshContract.getChapter(0, 0);
    expect(stored).to.equal("https://example.com/chapter/1.json");
  });
});
