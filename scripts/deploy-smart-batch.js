/**
 * Deploy the ERC-8211 Smart Batching adapter for Imagine on Tezos.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-smart-batch.js --network etherlink-shadownet
 *
 * Prerequisites:
 *   - Identity contract already deployed (set IDENTITY_CONTRACT in .env)
 *   - Deployer is the current owner of the identity contract
 */
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const identityAddr = process.env.IDENTITY_CONTRACT
    || process.env.VITE_CONTRACT_ADDRESS
    || "0xee1B97BC33A239EF0edf22D93b44c9a5CBB49B54";

  console.log("Identity contract:", identityAddr);

  // 1. Deploy SmartBatchStorage
  console.log("\n── Deploying SmartBatchStorage...");
  const Storage = await ethers.getContractFactory("SmartBatchStorage");
  const storage = await Storage.deploy();
  await storage.waitForDeployment();
  const storageAddr = await storage.getAddress();
  console.log("SmartBatchStorage deployed to:", storageAddr);

  // 2. Deploy ImagineSmartBatchAdapter
  console.log("\n── Deploying ImagineSmartBatchAdapter...");
  const Adapter = await ethers.getContractFactory("ImagineSmartBatchAdapter");
  const adapter = await Adapter.deploy(identityAddr, storageAddr);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("ImagineSmartBatchAdapter deployed to:", adapterAddr);

  // 3. Transfer agent + ownership to adapter
  console.log("\n── Configuring identity contract...");
  const identity = await ethers.getContractAt("ImagineOnTezosIdentity", identityAddr);

  const currentOwner = await identity.owner();
  if (currentOwner.toLowerCase() === deployer.address.toLowerCase()) {
    // Set agent first (requires owner)
    console.log("Setting agent to adapter...");
    const agentTx = await identity.setAgent(adapterAddr);
    await agentTx.wait();
    console.log("Agent set to:", adapterAddr);

    // Transfer ownership
    console.log("Transferring ownership to adapter...");
    const ownerTx = await identity.transferOwnership(adapterAddr);
    await ownerTx.wait();
    console.log("Ownership transferred to:", adapterAddr);
  } else {
    console.log("⚠ Deployer is not the current owner. Manual transfer required.");
    console.log("  Current owner:", currentOwner);
  }

  console.log("\n✅ Smart Batching deployment complete!");
  console.log("─".repeat(50));
  console.log("SmartBatchStorage:          ", storageAddr);
  console.log("ImagineSmartBatchAdapter:   ", adapterAddr);
  console.log("Identity contract:          ", identityAddr);
  console.log("─".repeat(50));
  console.log("\nAdd to .env:");
  console.log(`SMART_BATCH_ADAPTER=${adapterAddr}`);
  console.log(`SMART_BATCH_STORAGE=${storageAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
