const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const contractAddress = process.argv[2];
  const tokenId = process.argv[3];
  const chapterURI = process.argv[4];

  if (!contractAddress || tokenId === undefined || !chapterURI) {
    console.log("Usage: npx hardhat run scripts/add-chapter.js --network etherlinkShadownet -- <contractAddress> <tokenId> <chapterURI>");
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
