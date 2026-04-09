# Imagine on Tezos — AI‑Curated Identity Gallery on Etherlink

> **Hackathon submission: [Tezos EVM × AI Hackathon](https://tezosevm.nowmedia.co/)**
> **Track: AI Agents / Gaming & NFTs / Social & Identity**

**Imagine on Tezos** is an autonomous AI curatorial system that transforms social media posts tagged **#imagineontezos** into dynamic, evolving NFT identity portraits on Etherlink. A multi‑agent "Curated Labs" panel — three specialized AI curators plus a chief synthesizer — reads each post through chromatic, narrative, and pattern lenses, then mints a three‑layer NFT: DALL‑E generated abstract art, animated HTML artifact, and rich onchain metadata. Over time, the system tracks each author's identity evolution — archetype drift, sentiment arcs, epoch transitions — building a living gallery of the Tezos community's collective creative identity.

---

## Deployed Contract

```
Network:    Etherlink Shadownet (Chain ID 127823)
Contract:   0x6941C878657BE2bebe6BE7C339A282383D5C186A
Owner:      0xcc50149446bf9036F9f5aDb6e089a32D458620d7
Agent:      0xcc50149446bf9036F9f5aDb6e089a32D458620d7
Explorer:   https://explorer.shadownet.etherlink.com/address/0x6941C878657BE2bebe6BE7C339A282383D5C186A
```

---

## How AI is Integrated

This project is built around **AI as the core creative engine**, not a bolt‑on. Every NFT minted is the product of AI agents making curatorial decisions:

### 1. Multi‑Agent Curatorial Panel ("Curated Labs")

Three specialized GPT‑4o‑mini agents run **in parallel** on every incoming post:

| Agent | Lens | Output |
|---|---|---|
| **Chromatic Agent** | Visual/aesthetic | Palette (5 hex), texture, motion mode, abstract visual prompt |
| **Narrative Agent** | Story/meaning | Archetype (8 types), sentiment (8 types), title, summary, narrative arc |
| **Pattern Agent** | Cross‑identity | Keywords, themes, cultural resonances, epoch signal |

A **Chief Curator** agent then synthesizes all three readings into a unified interpretation — resolving conflicts, enriching the visual prompt with narrative context, and producing a gallery‑quality curator statement.

**Files:** `curatorPanel.js`, `llmClient.js`

### 2. AI‑Generated Art & Artifacts

- **DALL‑E 3** generates a unique abstract identity portrait from the Chromatic Agent's visual prompt + palette
- **`artifactRenderer.js`** creates a self‑contained HTML animation (`animation_url`) with motion CSS, archetype glyphs, and palette gradients
- Both are pinned to IPFS before minting

**Files:** `imagePipeline.js`, `artifactRenderer.js`

### 3. Evolving Identity Profiles

The system maintains an **identity memory** per author — tracking archetype drift, sentiment trajectories, resonance accumulation, and epoch state across all their mints. This prior context is fed back into the curatorial panel, so each new interpretation is informed by the author's full onchain history.

**Files:** `identityStore.js`, `db/identityDb.js`

### 4. AI Decision Engine

A decision module determines whether a new post should become a **new NFT** (new creative period) or a **chapter** appended to an existing token (continuation). It uses Jaccard similarity on AI‑extracted themes, not keyword matching.

**Files:** `decideAndActOnPost.js`, `curatePost.js`

### 5. Curatorial Wall Text Generator

An AI agent that reads an identity's full history (archetype shifts, sentiment arcs, accumulated resonances) and produces exhibition‑quality wall text — the kind you'd see at MoMA or Tate, contextualizing a body of work for gallery visitors.

**Files:** `wallTextGenerator.js`

---

## How Etherlink (Tezos EVM) is Integrated

- **Smart contract** — `ImagineOnTezosIdentity.sol`: custom ERC‑721 (Solidity 0.8.26, OpenZeppelin 5.x) with per‑token URI, `promptHash`, `originalAuthor`, agent role, and dynamic chapters. Deployed via Hardhat to Etherlink Shadownet.
- **Onchain identity evolution** — the `addChapter()` function lets the AI agent append new metadata URIs to existing tokens, representing how an author's identity transforms over time — an entirely onchain record of creative evolution.
- **500ms finality** — Etherlink's fast confirmation enables real‑time mint flow: paste URL → AI interprets → mint onchain → confirmation, all in a single user interaction.
- **All transactions** use Etherlink Shadownet RPC (`https://node.shadownet.etherlink.com`), chain ID `127823`.

---

## ERC‑8211 Smart Batching Integration

The project implements **[ERC‑8211 (Smart Batching)](https://github.com/ethereum/ERCs/pull/1638)** — a composable transaction execution standard that enables atomic multi‑step operations with dynamic parameter resolution. This turns what would normally require multiple separate transactions into a single, verifiable batch.

### Why Smart Batching?

| Problem | Smart Batching Solution |
|---|---|
| Minting + adding a chapter requires 2 transactions | `batchMintAndChapter()` — atomic in one call |
| No way to gate minting on chain state | `predicatedMintAndChapter()` — supply‑capped minting with on‑chain predicate |
| Static parameters only | `executeComposable()` — dynamic resolution via `STATIC_CALL` / `BALANCE` fetchers |
| No inter‑step data passing | `SmartBatchStorage` — namespaced key‑value store for captured return values |

### Contracts

| Contract | Purpose |
|---|---|
| `IComposableExecution.sol` | ERC‑8211 data types (`ComposableExecution`, `InputParam`, `OutputParam`, `Constraint`) and interface |
| `SmartBatchStorage.sol` | Namespaced key‑value store for passing data between batch steps |
| `ComposableExecutionLib.sol` | Shared execution engine — the normative 3‑step algorithm (resolve → execute → capture) |
| `ImagineSmartBatchAdapter.sol` | Adapter wrapping `ImagineOnTezosIdentity`: set as both owner and agent, exposes `executeComposable()` + convenience methods |

### Supported Features

- **Input parameter fetchers:** `RAW_BYTES`, `STATIC_CALL`, `BALANCE`
- **Output parameter capture:** `EXEC_RESULT`, `STATIC_CALL`
- **Constraints:** `EQ`, `GTE`, `LTE`, `IN` — validated before execution proceeds
- **Predicate entries:** target = `address(0)` skips the call but still resolves + validates (supply gates, state checks)
- **Reentrancy protection:** `ReentrancyGuard` on the adapter

### Usage

```bash
# Deploy the adapter (transfers identity ownership + agent)
npx hardhat run scripts/deploy-smart-batch.js --network etherlink-shadownet

# Run the demo (3 flows: batch, predicated, composable)
npx hardhat run scripts/smart-batch-demo.js --network etherlink-shadownet
```

---

## Architecture

```
X / Farcaster
    │  #imagineontezos posts
    ▼
┌─────────────┐     ┌──────────────────────────────┐
│  Schedulers  │────▶│  SQLite State Machine         │
│  (X + FC)    │     │  discovered → eligible → ...  │
└─────────────┘     └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Curatorial Panel    │
                    │  ┌────────────────┐  │
                    │  │ Chromatic Agent │  │
                    │  │ Narrative Agent │──┼──▶ Chief Curator ──▶ Unified Reading
                    │  │ Pattern  Agent  │  │
                    │  └────────────────┘  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Render Pipeline      │
                    │  DALL‑E 3 → image     │
                    │  HTML → artifact      │
                    │  JSON → metadata      │
                    │  All pinned to IPFS   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Etherlink Contract   │
                    │  mintTo() / addChap() │
                    │  ERC‑721 on Shadownet │
                    └──────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │  React Gallery        │
                    │  Identity cards +     │
                    │  panel readings +     │
                    │  live mint form       │
                    └──────────────────────┘
```

---

## Setup Instructions

### Prerequisites

- Node.js v18+
- An Etherlink Shadownet wallet with test XTZ ([faucet](https://faucet.etherlink.com/))
- OpenAI API key (GPT‑4o‑mini + DALL‑E 3)
- Pinata account for IPFS pinning

### 1. Clone & Install

```bash
git clone https://github.com/gitzhubjunkie/imagine-on-tezos-agent.git
cd imagine-on-tezos-agent
npm install
cd frontend && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```
ETHERLINK_PRIVATE_KEY=0x<your_key>
OPENAI_API_KEY=sk-...
PINATA_JWT=eyJ...
CONTRACT_ADDRESS=0x6941C878657BE2bebe6BE7C339A282383D5C186A
CONTRACT_OWNER_ADDRESS=0xcc50149446bf9036F9f5aDb6e089a32D458620d7
MINT_TO_ADDRESS=0xcc50149446bf9036F9f5aDb6e089a32D458620d7
```

### 3. Deploy Contract (or use the existing one)

```bash
npx hardhat run scripts/deploy.js --network etherlink
```

### 4. Run Tests

```bash
npx hardhat test        # 34 contract tests (21 core + 13 Smart Batching)
```

### 5. Start the Server

```bash
node server.js          # API on http://localhost:3001
```

### 6. Start the Frontend

```bash
cd frontend
npm run dev             # Vite dev server on http://localhost:5173
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/resolve-tweet` | Resolve X post by URL, validate #imagineontezos |
| `POST` | `/api/resolve-cast` | Resolve Farcaster cast by Warpcast URL |
| `POST` | `/api/interpret-post` | Multi‑agent AI curatorial interpretation |
| `POST` | `/api/dynamic-mint` | Full pipeline: AI → image → artifact → IPFS → mint |
| `GET` | `/api/identity/:handle` | Get evolving identity profile for an author |
| `GET` | `/api/identity/:handle/wall-text` | Generate exhibition wall text for an identity |
| `GET` | `/api/tweets` | Pipeline tweet list (filterable by status/source) |
| `GET` | `/api/stats` | Scheduler and worker status |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity 0.8.26, OpenZeppelin 5.x, Hardhat, ERC‑8211 Smart Batching |
| Blockchain | Etherlink Shadownet (Tezos EVM L2) |
| AI interpretation | OpenAI GPT‑4o‑mini (JSON mode, temperature 0.3) |
| Image generation | DALL‑E 3 (1024×1024) |
| IPFS | Pinata |
| Backend | Express 5, better‑sqlite3 |
| Frontend | React 19, Vite 8, ethers 6 |
| Social ingestion | X oEmbed API, Neynar Hub API (Farcaster) |

---

## Project Structure

```
contracts/                  # Solidity smart contracts
  ImagineOnTezosIdentity.sol
  smartbatching/
    IComposableExecution.sol        # ERC‑8211 types + interface
    SmartBatchStorage.sol           # Namespaced key‑value store
    ComposableExecutionLib.sol      # Shared execution engine
    ImagineSmartBatchAdapter.sol    # Adapter wrapping identity contract
curatorPanel.js             # Multi‑agent curatorial panel (Curated Labs)
aiInterpreter.js            # Single‑agent interpreter (legacy/fallback)
wallTextGenerator.js        # Exhibition wall text generator
identityStore.js            # Evolving identity profiles
imagePipeline.js            # DALL‑E 3 image generation + SVG fallback
artifactRenderer.js         # HTML artifact builder (animation_url)
decideAndActOnPost.js       # Decision engine: mint vs chapter
curatePost.js               # LLM curator with theme normalization
server.js                   # Express API server
mintWorker.js               # Automated mint pipeline worker
db/
  identityDb.js             # SQLite schema (works + identity_profiles)
  tweetStore.js             # Tweet pipeline state machine
xClient.js                  # X/Twitter client (oEmbed + v2)
farcasterClient.js          # Farcaster client (Neynar Hub API)
scheduler.js                # X ingestion scheduler
farcasterScheduler.js       # Farcaster ingestion scheduler
frontend/                   # React gallery + mint form
scripts/
  deploy-smart-batch.js     # Deploy Smart Batching adapter
  smart-batch-demo.js       # Demo: batch, predicated, composable flows
test/
  ImagineOnTezosIdentity.js # 21 core contract tests
  SmartBatching.js          # 13 ERC‑8211 Smart Batching tests
  decisionLogic.js          # Decision engine tests
```

---

## Team

- **Dorian Batycka** — [@temp_projects](https://x.com/temp_projects)

---

## License

MIT
