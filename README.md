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
Contract: 0x8f405FC638505575e4A4Ea91a1BCd7a38bDc2b37
Agent: 0xcc50149446bf9036F9f5aDb6e089a32D458620d7
```

## Implementation Details

### 1. Curator agent (AI layer)

**File:** `curatePost.js`

`callCuratorLLM(rawText, handle)`
- Uses OpenAI's Node SDK to call an LLM with a strict system prompt.
- Returns JSON fields: `themes[]`, `tone`, `score`, `curatorDescription`.
- Wrapped with:
  - **Retry:** up to 3 attempts with exponential backoff.
  - **Fallback:** if parsing fails, returns a heuristic default (`themes: ["general"]`, `score: 0.5`).

**Theme normalization + score clamping:**

- `normalizeThemeLabel(raw)` — Maps arbitrary LLM labels into an 8‑label vocabulary: `finance`, `governance`, `ai`, `art`, `tezos`, `landscape`, `identity`, `general`.
- `normalizeThemes(rawThemes)` — Applies `normalizeThemeLabel` and deduplicates.
- `clampScore(raw)` — Forces scores into a narrow range and supports test overrides (`[FORCE_SKIP]`, `[FORCE_CHAPTER]`) for deterministic behavior.

The result is a stable, bounded input into the decision engine: small theme space, predictable scores, and no hard crashes on malformed JSON.

### 2. Image + IPFS pipeline

**Files:** `imagePipeline.js`, `pinataClient.js`

`generateImageAndMetadata(input)`
- Creates a placeholder PNG buffer (1×1 transparent) and uploads it to IPFS via Pinata (`pinFileBufferToIpfs`).
- Builds ERC‑721 metadata JSON with: `name`, `description` (curator text), `image` (IPFS URI), `attributes` (handle, themes, tone, prompt, style).
- Uploads metadata JSON via `pinJsonToIpfs` and returns: `imageUri`, `metadataUri`.

`pinFileBufferToIpfs(buffer, filename)` / `pinJsonToIpfs(body, name)`
- Thin wrappers over Pinata's REST API, authenticated with a JWT.
- Return both the IPFS hash and a gateway URI.

Swapping in a real diffusion or image API only requires changing the buffer generation; the IPFS + metadata logic remains identical.

### 3. On‑chain identity contract

**File:** `contracts/ImagineOnTezosIdentity.sol`

Inherits `ERC721` + `Ownable`.

**Storage:**
- `mapping(uint256 => bytes32) public promptHash`
- `mapping(uint256 => address) public originalAuthor`
- `string private baseURI`
- `address public agent`
- `mapping(uint256 => string[]) public chapters`
- `uint256 private _tokenIdCounter`

**Key functions:**

- `mintTo(address to, string tokenURI, bytes32 promptHash_) external onlyOwner` — Increments `_tokenIdCounter`, calls `_safeMint(to, newId)`, sets `promptHash` and `originalAuthor`, emits `Minted`.
- `setAgent(address _agent) external onlyOwner` — Sets the off‑chain agent EOA allowed to append chapters, emits `AgentUpdated`.
- `addChapter(uint256 tokenId, string chapterURI) external` — Requires `msg.sender == agent` and token exists. Appends `chapterURI` to `chapters[tokenId]`, emits `ChapterAdded`.
- **View helpers:** `getChapterCount(tokenId)`, `getChapter(tokenId, index)`, `currentTokenId()`.

The contract is deployed to Etherlink Shadownet using Hardhat and the official RPC, and all agent interactions go through this single entry point.

### 4. Decision engine (new token vs chapter)

**File:** `decideAndActOnPost.js`

`decideAndActOnPost(curated, getLastWorkForHandle, saveNewWorkForHandle, mintNft, addChapter)`

All dependencies are injected (pure function given its inputs). Logic:

1. If `score < 0.6` → **skip** (returns `null`).
2. If no `LastWork` → **mint**: calls `mintNft(walletAddress, rawText, metadataUri)`, saves new `LastWork` with `chapterCount = 0`.
3. Else:
   - Computes Jaccard similarity between `curated.themes` and `LastWork.mainThemes`.
   - If similarity ≥ threshold and `chapterCount < MAX_CHAPTERS_PER_TOKEN` and `chapterUri` exists → **addChapter**, increments `chapterCount`.
   - Otherwise → **mint** new token (new "period"), resets `chapterCount = 0`.

Heavily unit‑tested with mocked `mintNft` / `addChapter` to cover skip, mint, chapter, and max‑chapters cases.

### 5. Persistence: identity memory

**Files:** `identityStore.js`, `db/identityDb.js`

SQLite via `better-sqlite3`, single table:

```sql
CREATE TABLE IF NOT EXISTS works (
  handle TEXT PRIMARY KEY,
  lastTokenId INTEGER NOT NULL,
  mainThemes TEXT NOT NULL,    -- JSON string of string[]
  chapterCount INTEGER NOT NULL
);
```

**Functions:**
- `getLastWorkForHandle(handle)` — Returns last token id, themes, and chapter count for a given handle, or `null`.
- `saveNewWorkForHandle(handle, work)` — Upserts `lastTokenId`, `mainThemes`, and `chapterCount` for a handle.

This small "identity memory" is what lets the agent reason over a user's onchain practice (themes + chapters) rather than treating each post as a one‑off.

## License

MIT
