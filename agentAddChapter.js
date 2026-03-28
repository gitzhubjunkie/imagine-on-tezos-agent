const { config: loadEnv } = require("dotenv");
const { ethers } = require("ethers");

loadEnv();

const RPC_URL = process.env.ETHERLINK_RPC_URL;
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// Minimal ABI: only what the agent needs
const ABI = [
  "function addChapter(uint256 tokenId, string chapterURI) external",
  "function getChapterCount(uint256 tokenId) external view returns (uint256)",
];

async function addChapter(tokenId, chapterURI) {
  // 1. Provider + wallet (agent)
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("Agent wallet:", await wallet.getAddress());

  // 2. Contract instance with signer
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  // 3. Send tx
  console.log(`Calling addChapter(${tokenId}, ${chapterURI})...`);
  const tx = await contract.addChapter(tokenId, chapterURI);
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // 4. Optional: check new chapter count
  const count = await contract.getChapterCount(tokenId);
  console.log(`New chapter count for token ${tokenId}:`, count.toString());

  return { txHash: tx.hash, chapterCount: count };
}

// Example direct run
if (require.main === module) {
  const tokenId = 0;
  const chapterURI = "https://example.com/chapters/0-1.json";

  addChapter(tokenId, chapterURI).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { addChapter };
