const { config: loadEnv } = require("dotenv");
const { ethers } = require("ethers");

loadEnv();

const RPC_URL = process.env.ETHERLINK_RPC_URL;
const PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const ABI = [
  "function mintTo(address to, string tokenURI, bytes32 promptHash_) external",
  "function owner() view returns (address)",
  "function currentTokenId() view returns (uint256)",
];

async function mintNft(to, promptText, tokenURI) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("Minter wallet:", await wallet.getAddress());

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  // Safety: confirm this signer is actually the owner
  const ownerOnChain = await contract.owner();
  if (ownerOnChain.toLowerCase() !== (await wallet.getAddress()).toLowerCase()) {
    throw new Error(`Signer is not contract owner. on-chain owner=${ownerOnChain}`);
  }

  const promptHash = ethers.keccak256(ethers.toUtf8Bytes(promptText));

  console.log(`Minting to ${to} with promptHash ${promptHash}`);
  const tx = await contract.mintTo(to, tokenURI, promptHash);
  console.log("mintTo tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // currentTokenId is incremented AFTER mint, so last tokenId = currentTokenId - 1
  const current = await contract.currentTokenId();
  const lastTokenId = current - 1n;

  console.log("Minted tokenId:", lastTokenId.toString());
  return { txHash: tx.hash, tokenId: lastTokenId.toString() };
}

// Example CLI run
if (require.main === module) {
  const to = "0xcc50149446bf9036F9f5aDb6e089a32D458620d7";
  const promptText = "first #imagineontezos via agent";
  const tokenURI = "ignored-uri";

  mintNft(to, promptText, tokenURI).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { mintNft };
