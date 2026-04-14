// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title IPositionToken
 * @notice ERC721 position NFT minted for each open perpetual; only `TradingCore` may mint/burn/update metadata.
 */
interface IPositionToken is IERC721 {
    event PositionTokenMinted(address indexed to, uint256 indexed tokenId, address indexed market, bool isLong);

    event PositionTokenBurned(uint256 indexed tokenId);

    event BaseURIUpdated(string newBaseURI);

    event TradingCoreUpdated(address indexed newTradingCore);

    event TransferFeeUpdated(uint256 oldFee, uint256 newFee);

    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /**
     * @notice Legacy mint entrypoint; prefer the overload that records market direction.
     */
    function mint(address to, uint256 tokenId) external;

    /**
     * @notice Mint a new position NFT tied to `positionId` / `market` / `isLong`.
     * @return tokenId The ERC721 id (typically equals `positionId` in the current deployment).
     */
    function mint(address to, uint256 positionId, address market, bool isLong) external returns (uint256 tokenId);

    /**
     * @notice Burn a position NFT after full close (only `TradingCore`).
     */
    function burn(uint256 tokenId) external;

    /**
     * @notice Set the sole minter/burner (`TradingCore`) address.
     */
    function setTradingCore(address _tradingCore) external;

    /**
     * @notice Configure optional secondary-market transfer fee in basis points.
     */
    function setTransferFee(uint256 feeBps) external;

    /**
     * @notice Recipient of transfer fees when enabled.
     */
    function setFeeRecipient(address recipient) external;

    /**
     * @notice Update off-chain metadata base URI for `tokenURI`.
     */
    function setBaseURI(string memory newBaseURI) external;

    /// @notice ERC721 owner of `tokenId` (reverts if burned or never minted).
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Number of position NFTs held by `owner`.
    function balanceOf(address owner) external view returns (uint256);

    /// @notice Metadata URI for `tokenId` (off-chain JSON per `baseTokenURI` convention).
    function tokenURI(uint256 tokenId) external view returns (string memory);

    /**
     * @notice Market contract associated with a minted position.
     */
    function getPositionMarket(uint256 tokenId) external view returns (address);

    /**
     * @notice True if long, false if short.
     */
    function getPositionDirection(uint256 tokenId) external view returns (bool isLong);

    /**
     * @notice Whether `tokenId` exists (not burned).
     */
    function positionExists(uint256 tokenId) external view returns (bool);

    /**
     * @notice Enumerate all token ids currently held by `owner` (may be large; prefer off-chain indexer for scale).
     */
    function getPositionsByOwner(address owner) external view returns (uint256[] memory);

    /**
     * @notice ERC721Enumerable-style supply counter when implemented.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @notice Lifetime mint counter for analytics caps.
     */
    function totalMinted() external view returns (uint256);

    /**
     * @notice Lifetime burn counter.
     */
    function totalBurned() external view returns (uint256);

    /**
     * @notice Address of the linked `TradingCore`.
     */
    function tradingCore() external view returns (address);

    /**
     * @notice Transfer fee in basis points (0 disables).
     */
    function transferFeeBps() external view returns (uint256);

    /**
     * @notice Fee sink for secondary transfers.
     */
    function feeRecipient() external view returns (address);

    /**
     * @notice Prefix used to build `tokenURI` results.
     */
    function baseTokenURI() external view returns (string memory);
}
