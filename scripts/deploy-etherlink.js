const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Imagine = await ethers.getContractFactory("ImagineOnTezosIdentity");
  const contract = await Imagine.deploy(
    "ImagineOnTezosIdentity",
    "IMAGINE",
    "https://example.com/metadata/"
  );
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("ImagineOnTezosIdentity deployed to:", contractAddress);

  // Set the agent to the deployer (you can change this to your agent wallet)
  const agentTx = await contract.setAgent(deployer.address);
  await agentTx.wait();
  console.log("Agent set to:", deployer.address);

  console.log("\n✅ Deployment complete!");
  console.log("Contract address:", contractAddress);
  console.log("Agent address:", deployer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
