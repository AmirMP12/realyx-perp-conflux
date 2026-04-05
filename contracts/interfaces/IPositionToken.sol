// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IPositionToken
 * @notice Interface for the PositionToken
 */
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IPositionToken is IERC721 {
    event PositionTokenMinted(
        address indexed to, 
        uint256 indexed tokenId, 
        address indexed market, 
        bool isLong
    );
    
    event PositionTokenBurned(uint256 indexed tokenId);
    
    event BaseURIUpdated(string newBaseURI);
    
    event TradingCoreUpdated(address indexed newTradingCore);
    
    event TransferFeeUpdated(uint256 oldFee, uint256 newFee);
    
    event FeeRecipientUpdated(
        address indexed oldRecipient, 
        address indexed newRecipient
    );

    function mint(address to, uint256 tokenId) external;
    
    function mint(
        address to,
        uint256 positionId,
        address market,
        bool isLong
    ) external returns (uint256 tokenId);
    
    function burn(uint256 tokenId) external;

    function setTradingCore(address _tradingCore) external;
    
    function setTransferFee(uint256 feeBps) external;
    
    function setFeeRecipient(address recipient) external;
    
    function setBaseURI(string memory newBaseURI) external;

    function ownerOf(uint256 tokenId) external view returns (address);
    
    function balanceOf(address owner) external view returns (uint256);
    
    function tokenURI(uint256 tokenId) external view returns (string memory);
    
    function getPositionMarket(uint256 tokenId) external view returns (address);
    
    function getPositionDirection(uint256 tokenId) external view returns (bool isLong);
    
    function positionExists(uint256 tokenId) external view returns (bool);
    
    function getPositionsByOwner(address owner) external view returns (uint256[] memory);
    
    function totalSupply() external view returns (uint256);
    
    function totalMinted() external view returns (uint256);
    
    function totalBurned() external view returns (uint256);
    
    function tradingCore() external view returns (address);
    
    function transferFeeBps() external view returns (uint256);
    
    function feeRecipient() external view returns (address);
    
    function baseTokenURI() external view returns (string memory);
}
