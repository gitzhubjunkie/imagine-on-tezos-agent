const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const contractAddress = process.argv[2];
  const toAddress = process.argv[3];
  const promptText = process.argv[4] || "default prompt";

  if (!contractAddress || !toAddress) {
    console.log("Usage: npx hardhat run scripts/mint.js --network etherlinkShadownet -- <contractAddress> <toAddress> [promptText]");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Minting with:", deployer.address);

  const contract = await ethers.getContractAt("ImagineOnTezosIdentity", contractAddress);

  // Hash the prompt
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes(promptText));
  console.log("Prompt text:", promptText);
  console.log("Prompt hash:", promptHash);

  const tx = await contract.mintTo(toAddress, "ignored-uri", promptHash);
  await tx.wait();

  const tokenId = await contract.currentTokenId();
  const actualTokenId = tokenId.toBigInt() - 1n;

  console.log("Minted token #" + actualTokenId.toString() + " to:", toAddress);
  console.log("Transaction hash:", tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
