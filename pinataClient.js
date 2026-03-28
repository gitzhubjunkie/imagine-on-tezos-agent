require("dotenv").config();
const axios = require("axios");
const FormData = require("form-data");

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY =
  process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs/";

if (!PINATA_JWT) {
  throw new Error("PINATA_JWT missing in .env");
}

async function pinJsonToIpfs(body, name = "imagineontezos-metadata") {
  const res = await axios.post(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    {
      pinataMetadata: { name },
      pinataContent: body,
    },
    {
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
    }
  );

  const hash = res.data.IpfsHash;
  return { hash, uri: `${PINATA_GATEWAY}${hash}` };
}

async function pinFileBufferToIpfs(buffer, filename = "imagineontezos.png") {
  const data = new FormData();
  data.append("file", buffer, { filename });

  const res = await axios.post(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    data,
    {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        ...data.getHeaders(),
      },
    }
  );

  const hash = res.data.IpfsHash;
  return { hash, uri: `${PINATA_GATEWAY}${hash}` };
}

module.exports = { pinJsonToIpfs, pinFileBufferToIpfs };
