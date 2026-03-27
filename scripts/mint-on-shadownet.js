const { ethers } = require("hardhat");

async function main() {
  // 1. Set your deployed contract address here
  const contractAddress = "0x809C80151BaC0EA548a05d090ef61DE0b137D7d9";

  // 2. Get signer (uses your ETHERLINK_PRIVATE_KEY from hardhat.config)
  const [signer] = await ethers.getSigners();
  console.log("Using signer:", signer.address);

  // 3. Attach to deployed contract
  const Imagine = await ethers.getContractFactory("ImagineOnTezosIdentity");
  const contract = Imagine.attach(contractAddress);

  // 4. Prepare fake prompt hash
  const promptText = "first #imagineontezos mint";
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes(promptText));

  // 5. Call mintTo: owner-only (signer must be owner)
  const to = signer.address;
  const tokenURI = "ignored-uri"; // placeholder, baseURI is used

  console.log("Minting to:", to);
  const tx = await contract.mintTo(to, tokenURI, promptHash);
  console.log("Tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Tx confirmed in block:", receipt.blockNumber);

  // 6. Optional: check ownerOf(0)
  const ownerOf0 = await contract.ownerOf(0);
  console.log("ownerOf(0):", ownerOf0);

  const storedPromptHash = await contract.promptHash(0);
  console.log("stored promptHash(0):", storedPromptHash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
