import { ethers } from "hardhat";

async function main() {
  const contractAddress = "0x8f405FC638505575e4A4Ea91a1BCd7a38bDc2b37";
  const tokenId = 0; // token you want to extend

  const chapterURI = "https://example.com/chapters/0-1.json";

  const [agentSigner] = await ethers.getSigners();
  console.log("Agent signer (should match agent):", agentSigner.address);

  const Imagine = await ethers.getContractFactory("ImagineOnTezosIdentity");
  const contract = Imagine.attach(contractAddress).connect(agentSigner);

  const tx = await contract.addChapter(tokenId, chapterURI);
  console.log("addChapter tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  const count = await contract.getChapterCount(tokenId);
  console.log("Chapter count:", count.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
