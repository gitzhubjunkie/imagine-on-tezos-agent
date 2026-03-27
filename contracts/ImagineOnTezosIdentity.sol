// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ImagineOnTezosIdentity is ERC721, Ownable {
    // tokenId => hash of original text prompt
    mapping(uint256 => bytes32) public promptHash;

    // tokenId => original author address (e.g. wallet you mint to)
    mapping(uint256 => address) public originalAuthor;

    // simple incremental counter
    uint256 private _tokenIdCounter;

    // base URI for metadata
    string private baseURI;

    // --- agent + dynamic chapters ---

    // address allowed to append chapters / dynamic metadata
    address public agent;

    // tokenId => list of chapter URIs (off-chain JSONs describing evolution)
    mapping(uint256 => string[]) public chapters;

    event Minted(uint256 indexed tokenId, address indexed to, bytes32 promptHash);
    event AgentUpdated(address indexed newAgent);
    event ChapterAdded(uint256 indexed tokenId, string chapterURI);

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseURI
    ) ERC721(_name, _symbol) Ownable(msg.sender) {
        baseURI = _baseURI;
    }

    // --- minting ---

    function mintTo(
        address to,
        string calldata tokenURI,   // currently ignored; using baseURI + tokenId
        bytes32 promptHash_
    ) external onlyOwner {
        uint256 newId = _tokenIdCounter;
        _tokenIdCounter = newId + 1;

        _safeMint(to, newId);

        promptHash[newId] = promptHash_;
        originalAuthor[newId] = to;

        emit Minted(newId, to, promptHash_);
    }

    // --- baseURI management ---

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function setBaseURI(string calldata _baseURI) external onlyOwner {
        baseURI = _baseURI;
    }

    function currentTokenId() external view returns (uint256) {
        return _tokenIdCounter;
    }

    // --- agent management ---

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    // --- dynamic identity chapters ---

    function addChapter(uint256 tokenId, string calldata chapterURI) external {
        require(msg.sender == agent, "only agent");
        require(_ownerOf(tokenId) != address(0), "nonexistent token");

        chapters[tokenId].push(chapterURI);

        emit ChapterAdded(tokenId, chapterURI);
    }

    function getChapterCount(uint256 tokenId) external view returns (uint256) {
        return chapters[tokenId].length;
    }

    function getChapter(uint256 tokenId, uint256 index) external view returns (string memory) {
        return chapters[tokenId][index];
    }
}

