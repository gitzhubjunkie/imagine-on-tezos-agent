# ImagineOnTezosIdentity

ERC-721 NFT contract with dynamic chapter management deployed to Etherlink Shadownet.

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
