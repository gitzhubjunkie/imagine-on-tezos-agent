// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IComposableExecution.sol";
import "./ComposableExecutionLib.sol";
import "../ImagineOnTezosIdentity.sol";

/**
 * @title ImagineSmartBatchAdapter — ERC-8211 adapter for Imagine on Tezos
 * @notice Wraps the ImagineOnTezosIdentity contract with Smart Batching,
 *         enabling atomic mint-and-chapter flows, predicate-gated minting,
 *         and dynamic parameter resolution at execution time.
 *
 * @dev This adapter is set as both owner AND agent of the identity contract.
 *      It exposes ERC-8211 executeComposable() for general composable batches,
 *      plus a convenience batchMintAndChapter() for the most common flow.
 *
 *      Architecture (per ERC-8211 "native account integration"):
 *      ┌─────────────────────────────────────────┐
 *      │   ImagineSmartBatchAdapter               │
 *      │   (owner + agent of identity contract)   │
 *      │                                          │
 *      │   executeComposable() ─────────┐         │
 *      │   batchMintAndChapter() ───┐   │         │
 *      │                           ▼   ▼         │
 *      │         ComposableExecutionLib           │
 *      │              ↓         ↓                 │
 *      │     SmartBatchStorage  Identity          │
 *      └─────────────────────────────────────────┘
 */
contract ImagineSmartBatchAdapter is IComposableExecution, Ownable {
    using ComposableExecutionLib for ComposableExecution[];

    ImagineOnTezosIdentity public immutable identity;
    SmartBatchStorage public immutable batchStorage;

    // Reentrancy guard
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    event BatchMintAndChapter(uint256 indexed tokenId, address indexed to, string chapterURI);

    constructor(
        address _identity,
        address _storage
    ) Ownable(msg.sender) {
        identity = ImagineOnTezosIdentity(_identity);
        batchStorage = SmartBatchStorage(_storage);
    }

    // ── ERC-8211: General composable execution ──────────

    /**
     * @notice Execute a composable batch per ERC-8211.
     *         Each entry's parameters are resolved at execution time.
     */
    function executeComposable(
        ComposableExecution[] calldata executions
    ) external payable override onlyOwner nonReentrant {
        executions.execute(address(batchStorage), address(this));
    }

    // ── Convenience: Atomic mint + chapter ──────────────

    /**
     * @notice Atomic mint-and-chapter in a single transaction.
     *         Resolves the next tokenId at execution time via STATIC_CALL,
     *         mints the token, then adds the first chapter — all atomically.
     *
     * @param to          Recipient of the NFT
     * @param uri         Token metadata URI (IPFS)
     * @param promptHash  Hash of the original text prompt
     * @param chapterURI  First chapter URI (IPFS)
     */
    function batchMintAndChapter(
        address to,
        string calldata uri,
        bytes32 promptHash,
        string calldata chapterURI
    ) external onlyOwner nonReentrant {
        // Step 1: Read the next tokenId (will be assigned by mint)
        uint256 nextId = identity.currentTokenId();

        // Step 2: Mint the token
        identity.mintTo(to, uri, promptHash);

        // Step 3: Add the first chapter using the resolved tokenId
        identity.addChapter(nextId, chapterURI);

        emit BatchMintAndChapter(nextId, to, chapterURI);
    }

    /**
     * @notice Predicate-gated batch mint: only executes if on-chain
     *         conditions are met (e.g., token supply below a cap).
     *
     * @param to          Recipient of the NFT
     * @param uri         Token metadata URI
     * @param promptHash  Hash of the original text prompt
     * @param chapterURI  First chapter URI
     * @param maxSupply   Supply cap — reverts if currentTokenId >= maxSupply
     */
    function predicatedMintAndChapter(
        address to,
        string calldata uri,
        bytes32 promptHash,
        string calldata chapterURI,
        uint256 maxSupply
    ) external onlyOwner nonReentrant {
        // Predicate: supply must be below cap
        uint256 currentSupply = identity.currentTokenId();
        require(currentSupply < maxSupply, "supply cap reached");

        // Atomic mint + chapter
        identity.mintTo(to, uri, promptHash);
        identity.addChapter(currentSupply, chapterURI);

        emit BatchMintAndChapter(currentSupply, to, chapterURI);
    }

    // ── Admin: transfer identity ownership/agent ────────

    /**
     * @notice Transfer ownership of the identity contract.
     *         Used for migration or upgrading the adapter.
     */
    function transferIdentityOwnership(address newOwner) external onlyOwner {
        identity.transferOwnership(newOwner);
    }

    /**
     * @notice Set the agent on the identity contract.
     */
    function setIdentityAgent(address newAgent) external onlyOwner {
        identity.setAgent(newAgent);
    }

    /// @notice Allow the adapter to receive ETH (for VALUE params).
    receive() external payable {}
}
