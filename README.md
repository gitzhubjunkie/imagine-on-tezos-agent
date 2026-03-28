# ImagineOnTezosIdentity

ERC-721 NFT contract with dynamic chapter management deployed to Etherlink Shadownet.

## Architecture Overview

**Social stream → Curator agent**
An off-chain AI curator listens to posts with #imagineontezos, cleans the text, and uses an LLM to extract themes, tone, quality score, and a short wall-text style description for each post.

**AI image + IPFS pipeline**
For posts above a quality threshold, the agent generates an image (stubbed or via diffusion), uploads the image to IPFS, and builds NFT metadata (name, description, image, attributes) that is also pinned to IPFS.

**Etherlink identity contract (ERC‑721)**
A custom ERC‑721 on Etherlink Shadownet stores each curated work as an NFT with promptHash and originalAuthor, plus an agent role that can append "chapters" (dynamic metadata URIs) to represent the evolution of a user's identity over time.

**Decision engine: new work vs chapter**
A small decision module compares the new post's normalized themes against the user's last onchain work; if similarity is high and chapter count is below a cap it calls addChapter, otherwise it calls mintTo to start a new onchain "period" in that identity.

**Identity gallery frontend**
A simple gallery UI on Etherlink lets users connect a wallet, browse their curated identity timeline (NFTs + chapters), and see AI-written curator texts that frame their Tezos practice as a living, evolving onchain exhibition rather than a one-off mint.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Etherlink Shadownet deployer private key and RPC URL:

```
DEPLOYER_PRIVATE_KEY=0x<your_private_key>
ETHERLINK_RPC_URL=https://node.shadownet.etherlink.com
```

## Contract Features

### Core ERC-721
- Standard NFT minting with `mintTo(address, tokenURI, bytes32 promptHash)`
- Owner-only minting
- Base URI configuration

### Dynamic Chapters Hook
- `mapping(uint256 => string[]) chapters` - Store chapter URIs per token
- `addChapter(uint256 tokenId, string chapterURI)` - Agent can append chapters
- `getChapters(uint256 tokenId)` - Retrieve all chapters for a token

### Agent Management
- `setAgent(address)` - Owner sets which address can add chapters
- `addChapter()` - Restricted to agent address only

## Scripts

### Deploy to Etherlink Shadownet

```bash
npx hardhat run scripts/deploy.js --network etherlink
```

Output includes:
- Contract address
- Agent address (initially the deployer)

### Mint an NFT

```bash
npx hardhat run scripts/mint.js --network etherlink -- <contractAddress> <toAddress> [promptText]
```

Example:
```bash
npx hardhat run scripts/mint.js --network etherlink -- 0x1234... 0x5678... "A beautiful portrait"
```

### Add a Chapter

```bash
npx hardhat run scripts/add-chapter.js --network etherlink -- <contractAddress> <tokenId> <chapterURI>
```

Example:
```bash
npx hardhat run scripts/add-chapter.js --network etherlink -- 0x1234... 0 "https://example.com/chapter-1"
```

## Testing

Run local Hardhat tests:

```bash
npx hardhat test
```

Tests cover:
- Deployment
- Minting with prompt hash storage
- Owner-only access control
- Agent setup
- Chapter addition with agent restrictions
- Multiple chapters per token

## Network Configuration

**Etherlink Shadownet**
- Chain ID: 127823
- RPC: https://node.shadownet.etherlink.com
- Network: `etherlink` (in hardhat.config.js)

## Contract Addresses

Once deployed, update this section:

```
Network: Etherlink Shadownet
Contract: 0x...
Agent: 0x...
```

## License

MIT
