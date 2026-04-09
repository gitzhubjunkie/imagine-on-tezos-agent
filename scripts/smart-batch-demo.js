/**
 * Demonstrate ERC-8211 Smart Batching: atomic mint + chapter in one transaction.
 *
 * Usage:
 *   npx hardhat run scripts/smart-batch-demo.js --network etherlink-shadownet
 *
 * Requires SMART_BATCH_ADAPTER in .env (from deploy-smart-batch.js output).
 */
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const adapterAddr = process.env.SMART_BATCH_ADAPTER;
  if (!adapterAddr) {
    console.error("Set SMART_BATCH_ADAPTER in .env (run deploy-smart-batch.js first)");
    process.exit(1);
  }

  const adapter = await ethers.getContractAt("ImagineSmartBatchAdapter", adapterAddr);
  const identityAddr = await adapter.identity();
  const identity = await ethers.getContractAt("ImagineOnTezosIdentity", identityAddr);

  const supplyBefore = await identity.currentTokenId();
  console.log("\nCurrent supply:", supplyBefore.toString());

  // ── Demo 1: Atomic mint + chapter ──────────────────

  console.log("\n── Demo 1: batchMintAndChapter() ──");
  console.log("   Minting token + first chapter in ONE transaction...");

  const uri = "ipfs://QmSmartBatchDemo";
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes("smart-batching-demo"));
  const chapterURI = "ipfs://QmSmartBatchChapter1";

  const tx1 = await adapter.batchMintAndChapter(
    signer.address, uri, promptHash, chapterURI
  );
  const receipt1 = await tx1.wait();

  const newSupply = await identity.currentTokenId();
  const tokenId = Number(newSupply) - 1;
  console.log("   ✅ Token #" + tokenId + " minted atomically");
  console.log("   Chapter count:", (await identity.getChapterCount(tokenId)).toString());
  console.log("   Gas used:", receipt1.gasUsed.toString());
  console.log("   Tx:", receipt1.hash);

  // ── Demo 2: Predicated mint ────────────────────────

  console.log("\n── Demo 2: predicatedMintAndChapter() ──");
  console.log("   Minting with supply cap predicate (max 100)...");

  const tx2 = await adapter.predicatedMintAndChapter(
    signer.address,
    "ipfs://QmPredicatedMint",
    ethers.keccak256(ethers.toUtf8Bytes("predicated-demo")),
    "ipfs://QmPredicatedChapter",
    100 // supply cap
  );
  const receipt2 = await tx2.wait();
  const tokenId2 = Number(await identity.currentTokenId()) - 1;
  console.log("   ✅ Token #" + tokenId2 + " minted (supply < 100 ✓)");
  console.log("   Gas used:", receipt2.gasUsed.toString());

  // ── Demo 3: Full ERC-8211 composable batch ────────

  console.log("\n── Demo 3: executeComposable() — full ERC-8211 ──");
  console.log("   Building composable batch: predicate check → addChapter...");

  // ERC-8211 enum values
  const InputParamType = { TARGET: 0, VALUE: 1, CALL_DATA: 2 };
  const FetcherType = { RAW_BYTES: 0, STATIC_CALL: 1, BALANCE: 2 };
  const ConstraintType = { EQ: 0, GTE: 1, LTE: 2, IN: 3 };

  const currentTokenIdCalldata = identity.interface.encodeFunctionData("currentTokenId");
  const addChapterSig = identity.interface.getFunction("addChapter").selector;

  const batch = [
    // Entry 0: Predicate — verify supply >= 1
    {
      functionSig: "0x00000000",
      inputParams: [{
        paramType: InputParamType.CALL_DATA,
        fetcherType: FetcherType.STATIC_CALL,
        paramData: ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "bytes"],
          [identityAddr, currentTokenIdCalldata]
        ),
        constraints: [{
          constraintType: ConstraintType.GTE,
          referenceData: ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32"],
            [ethers.zeroPadValue("0x01", 32)]
          ),
        }],
      }],
      outputParams: [],
    },
    // Entry 1: addChapter(tokenId, chapterURI)
    {
      functionSig: addChapterSig,
      inputParams: [
        {
          paramType: InputParamType.TARGET,
          fetcherType: FetcherType.RAW_BYTES,
          paramData: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [identityAddr]),
          constraints: [],
        },
        {
          paramType: InputParamType.CALL_DATA,
          fetcherType: FetcherType.RAW_BYTES,
          paramData: ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "string"],
            [tokenId, "ipfs://QmComposableChapter"]
          ),
          constraints: [],
        },
      ],
      outputParams: [],
    },
  ];

  const tx3 = await adapter.executeComposable(batch);
  const receipt3 = await tx3.wait();
  const chapters = await identity.getChapterCount(tokenId);
  console.log("   ✅ Chapter added via composable batch");
  console.log("   Token #" + tokenId + " now has", chapters.toString(), "chapters");
  console.log("   Gas used:", receipt3.gasUsed.toString());

  // Summary
  console.log("\n═══════════════════════════════════════");
  console.log("Smart Batching demo complete!");
  console.log("Final supply:", (await identity.currentTokenId()).toString());
  console.log("═══════════════════════════════════════");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
