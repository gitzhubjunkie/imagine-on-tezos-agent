require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { ETHERLINK_PRIVATE_KEY } = process.env;
const rawEtherlinkKey = ETHERLINK_PRIVATE_KEY?.startsWith("0x")
  ? ETHERLINK_PRIVATE_KEY.slice(2)
  : ETHERLINK_PRIVATE_KEY;
const validEtherlinkKey = rawEtherlinkKey && /^[0-9a-fA-F]{64}$/.test(rawEtherlinkKey);
const normalizedEtherlinkKey = validEtherlinkKey ? `0x${rawEtherlinkKey}` : undefined;

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { evmVersion: "cancun" },
  },
  networks: {
    "etherlink-shadownet": {
      url: "https://node.shadownet.etherlink.com",
      chainId: 127823,
      accounts: normalizedEtherlinkKey ? [normalizedEtherlinkKey] : [],
    },
  },
};
