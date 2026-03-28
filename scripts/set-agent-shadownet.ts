import { ethers } from "hardhat";

async function main() {
  // 1. Fill in your deployed contract address
  const contractAddress = "0x8f405FC638505575e4A4Ea91a1BCd7a38bDc2b37";

  // 2. The EOA that your backend agent will use
  const agentAddress = "0xcc50149446bf9036F9f5aDb6e089a32D458620d7";

  const [ownerSigner] = await ethers.getSigners();
  console.log("Owner signer:", ownerSigner.address);

  const Imagine = await ethers.getContractFactory("ImagineOnTezosIdentity");
  const contract = Imagine.attach(contractAddress).connect(ownerSigner);

  console.log("Setting agent to:", agentAddress);
  const tx = await contract.setAgent(agentAddress);
  console.log("Tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Tx confirmed in block:", receipt.blockNumber);

  const storedAgent = await contract.agent();
  console.log("Stored agent:", storedAgent);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
