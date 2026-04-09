const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartBatching — ERC-8211 Integration", function () {
  let identity, adapter, storage;
  let owner, recipient;

  // ERC-8211 enum values
  const InputParamType = { TARGET: 0, VALUE: 1, CALL_DATA: 2 };
  const InputParamFetcherType = { RAW_BYTES: 0, STATIC_CALL: 1, BALANCE: 2 };
  const OutputParamFetcherType = { EXEC_RESULT: 0, STATIC_CALL: 1 };
  const ConstraintType = { EQ: 0, GTE: 1, LTE: 2, IN: 3 };

  beforeEach(async () => {
    [owner, recipient] = await ethers.getSigners();

    // Deploy identity contract
    const Identity = await ethers.getContractFactory("ImagineOnTezosIdentity");
    identity = await Identity.deploy("ImagineOnTezosIdentity", "IMAGINE");
    await identity.waitForDeployment();

    // Deploy SmartBatchStorage
    const Storage = await ethers.getContractFactory("SmartBatchStorage");
    storage = await Storage.deploy();
    await storage.waitForDeployment();

    // Deploy adapter
    const Adapter = await ethers.getContractFactory("ImagineSmartBatchAdapter");
    adapter = await Adapter.deploy(
      await identity.getAddress(),
      await storage.getAddress()
    );
    await adapter.waitForDeployment();

    // Set agent to adapter, then transfer ownership to adapter
    await identity.setAgent(await adapter.getAddress());
    await identity.transferOwnership(await adapter.getAddress());
  });

  // ── Convenience methods ─────────────────────────────

  describe("batchMintAndChapter()", () => {
    it("atomically mints and adds first chapter", async () => {
      const uri = "ipfs://QmMetadata123";
      const promptHash = ethers.keccak256(ethers.toUtf8Bytes("test prompt"));
      const chapterURI = "ipfs://QmChapter1";

      const tx = await adapter.batchMintAndChapter(
        recipient.address, uri, promptHash, chapterURI
      );
      const receipt = await tx.wait();

      // Token 0 should exist
      expect(await identity.ownerOf(0)).to.equal(recipient.address);
      expect(await identity.tokenURI(0)).to.equal(uri);
      expect(await identity.promptHash(0)).to.equal(promptHash);
      expect(await identity.originalAuthor(0)).to.equal(recipient.address);

      // Chapter 0 should exist
      expect(await identity.getChapterCount(0)).to.equal(1);
      expect(await identity.getChapter(0, 0)).to.equal(chapterURI);

      // Should emit BatchMintAndChapter
      await expect(tx)
        .to.emit(adapter, "BatchMintAndChapter")
        .withArgs(0, recipient.address, chapterURI);
    });

    it("correctly resolves tokenId for second mint", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("p"));

      // First mint
      await adapter.batchMintAndChapter(
        recipient.address, "ipfs://meta1", hash, "ipfs://ch1"
      );

      // Second mint — tokenId should be 1
      await adapter.batchMintAndChapter(
        recipient.address, "ipfs://meta2", hash, "ipfs://ch2"
      );

      expect(await identity.currentTokenId()).to.equal(2);
      expect(await identity.getChapterCount(1)).to.equal(1);
      expect(await identity.getChapter(1, 0)).to.equal("ipfs://ch2");
    });

    it("reverts when called by non-owner", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("p"));
      await expect(
        adapter.connect(recipient).batchMintAndChapter(
          recipient.address, "ipfs://x", hash, "ipfs://ch"
        )
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });
  });

  // ── Predicated mint ─────────────────────────────────

  describe("predicatedMintAndChapter()", () => {
    it("mints when supply is below cap", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("p"));
      await adapter.predicatedMintAndChapter(
        recipient.address, "ipfs://meta", hash, "ipfs://ch", 10
      );
      expect(await identity.ownerOf(0)).to.equal(recipient.address);
    });

    it("reverts when supply cap is reached", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("p"));

      // Mint 2 tokens
      await adapter.batchMintAndChapter(recipient.address, "ipfs://m1", hash, "ipfs://c1");
      await adapter.batchMintAndChapter(recipient.address, "ipfs://m2", hash, "ipfs://c2");

      // Cap at 2 should fail
      await expect(
        adapter.predicatedMintAndChapter(
          recipient.address, "ipfs://m3", hash, "ipfs://c3", 2
        )
      ).to.be.revertedWith("supply cap reached");
    });
  });

  // ── ERC-8211: executeComposable() ──────────────────

  describe("executeComposable() — full ERC-8211 flow", () => {
    it("executes a composable batch with RAW_BYTES params", async () => {
      const identityAddr = await identity.getAddress();

      // Build a batch that calls identity.mintTo(recipient, uri, promptHash)
      // via the ERC-8211 composable execution engine
      const uri = "ipfs://QmComposableMint";
      const promptHash = ethers.keccak256(ethers.toUtf8Bytes("composable"));

      // Encode mintTo(address,string,bytes32)
      const mintSig = identity.interface.getFunction("mintTo").selector;

      const batch = [{
        functionSig: mintSig,
        inputParams: [
          // TARGET → identity contract address
          {
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [identityAddr]),
            constraints: [],
          },
          // CALL_DATA → abi.encode(to, uri, promptHash)
          {
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "string", "bytes32"],
              [recipient.address, uri, promptHash]
            ),
            constraints: [],
          },
        ],
        outputParams: [],
      }];

      await adapter.executeComposable(batch);

      expect(await identity.ownerOf(0)).to.equal(recipient.address);
      expect(await identity.tokenURI(0)).to.equal(uri);
    });

    it("executes with STATIC_CALL fetcher to resolve tokenId", async () => {
      const identityAddr = await identity.getAddress();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("dynamic"));

      // First mint via convenience method
      await adapter.batchMintAndChapter(
        recipient.address, "ipfs://existing", hash, "ipfs://ch"
      );

      // Now use executeComposable to add a chapter to the existing token
      // by resolving currentTokenId()-1 via STATIC_CALL
      const addChapterSig = identity.interface.getFunction("addChapter").selector;

      // We'll read currentTokenId() and subtract 1 to get the last minted token
      // For simplicity, we know token 0 exists, so use RAW_BYTES for the tokenId
      // But demonstrate STATIC_CALL for fetching currentTokenId
      const currentTokenIdCalldata = identity.interface.encodeFunctionData("currentTokenId");

      const batch = [{
        // Predicate entry: verify supply >= 1
        functionSig: "0x00000000",
        inputParams: [{
          paramType: InputParamType.CALL_DATA,
          fetcherType: InputParamFetcherType.STATIC_CALL,
          paramData: ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [identityAddr, currentTokenIdCalldata]
          ),
          constraints: [{
            constraintType: ConstraintType.GTE,
            referenceData: ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.zeroPadValue("0x01", 32)]),
          }],
        }],
        outputParams: [],
      }, {
        // Actual call: addChapter(0, "ipfs://chapter2")
        functionSig: addChapterSig,
        inputParams: [
          {
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [identityAddr]),
            constraints: [],
          },
          {
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: ethers.AbiCoder.defaultAbiCoder().encode(
              ["uint256", "string"],
              [0, "ipfs://chapter2-composable"]
            ),
            constraints: [],
          },
        ],
        outputParams: [],
      }];

      await adapter.executeComposable(batch);

      expect(await identity.getChapterCount(0)).to.equal(2);
      expect(await identity.getChapter(0, 1)).to.equal("ipfs://chapter2-composable");
    });

    it("reverts when a constraint fails", async () => {
      const identityAddr = await identity.getAddress();
      const currentTokenIdCalldata = identity.interface.encodeFunctionData("currentTokenId");

      // Predicate: require supply >= 100 (will fail — supply is 0)
      const batch = [{
        functionSig: "0x00000000",
        inputParams: [{
          paramType: InputParamType.CALL_DATA,
          fetcherType: InputParamFetcherType.STATIC_CALL,
          paramData: ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [identityAddr, currentTokenIdCalldata]
          ),
          constraints: [{
            constraintType: ConstraintType.GTE,
            referenceData: ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.zeroPadValue("0x64", 32)]),
          }],
        }],
        outputParams: [],
      }];

      await expect(adapter.executeComposable(batch))
        .to.be.revertedWithCustomError(
          { interface: new ethers.Interface(["error ConstraintFailed(uint256,uint256,uint256)"]) },
          "ConstraintFailed"
        );
    });

    it("non-owner cannot call executeComposable", async () => {
      await expect(
        adapter.connect(recipient).executeComposable([])
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });
  });

  // ── SmartBatchStorage ──────────────────────────────

  describe("SmartBatchStorage", () => {
    it("writes and reads a namespaced slot", async () => {
      const slot = ethers.keccak256(ethers.toUtf8Bytes("test-slot"));
      const value = ethers.keccak256(ethers.toUtf8Bytes("test-value"));
      const account = owner.address;

      await storage.writeStorage(slot, value, account);

      const ns = await storage.getNamespace(account, owner.address);
      const nsSlot = await storage.getNamespacedSlot(ns, slot);
      expect(await storage.isSlotInitialized(ns, slot)).to.be.true;
      expect(await storage.readStorage(ns, slot)).to.equal(value);
    });

    it("reverts reading uninitialized slot", async () => {
      const ns = ethers.keccak256(ethers.toUtf8Bytes("empty-ns"));
      const slot = ethers.keccak256(ethers.toUtf8Bytes("empty-slot"));
      await expect(storage.readStorage(ns, slot))
        .to.be.revertedWithCustomError(storage, "SlotNotInitialized");
    });
  });

  // ── Admin functions ────────────────────────────────

  describe("Admin", () => {
    it("can transfer identity ownership through adapter", async () => {
      await adapter.transferIdentityOwnership(owner.address);
      expect(await identity.owner()).to.equal(owner.address);
    });

    it("can set identity agent through adapter", async () => {
      await adapter.setIdentityAgent(recipient.address);
      expect(await identity.agent()).to.equal(recipient.address);
    });
  });
});
