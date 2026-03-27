import { ethers } from "hardhat";

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

  console.log("ImagineOnTezosIdentity deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
