const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const contractAddress = process.env.CONTRACT;
  const tokenId = process.env.TOKEN_ID;
  const chapterURI = process.env.CHAPTER_URI;

  if (!contractAddress || tokenId === undefined || !chapterURI) {
    console.log("Usage: CONTRACT=0x... TOKEN_ID=0 CHAPTER_URI='ipfs://...' npx hardhat run scripts/add-chapter.js --network etherlink-mainnet");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Adding chapter with:", deployer.address);

  const contract = await ethers.getContractAt("ImagineOnTezosIdentity", contractAddress);

  const tx = await contract.addChapter(tokenId, chapterURI);
  await tx.wait();

  console.log("Chapter added to token #" + tokenId);
  console.log("Chapter URI:", chapterURI);
  console.log("Transaction hash:", tx.hash);

  // Get all chapters
  const allChapters = await contract.getChapters(tokenId);
  console.log("Total chapters for token #" + tokenId + ":", allChapters.length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
