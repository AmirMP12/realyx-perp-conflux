// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../interfaces/IPositionToken.sol";
import "../interfaces/ITradingCore.sol";

/**
 * @title PositionToken
 * @notice ERC721 token representing trading positions
 * @dev Implements IPositionToken with transfer hooks for exposure tracking
 */
contract PositionToken is 
    ERC721Upgradeable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable 
{
    using Strings for uint256;

    error ZeroAddress();
    error TradingCoreAlreadySet();
    error NotTradingCore();
    error InvalidFee();
    error TokenDoesNotExist();
    error ContractRecipientNotAllowed();
    error UseCanonicalMint();
    error TransferFeeNotSupported();
    error TradingCoreUpdateFailed(string reason);
    error PositionOwnershipUpdateFailed();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 private constant MAX_FEE_BPS = 500;
    uint256 private constant BPS = 10000;

    string public baseTokenURI;
    uint256 public totalMinted;
    uint256 public totalBurned;
    
    address public tradingCore;
    uint256 public transferFeeBps;
    address public feeRecipient;

    mapping(uint256 => address) private _positionMarkets;
    mapping(uint256 => bool) private _positionDirections;
    mapping(address => uint256[]) private _ownerPositions;
    
    mapping(address => bool) public whitelistedContracts;
    
    uint256[43] private __gap;

    event PositionTokenMinted(address indexed to, uint256 indexed tokenId, address indexed market, bool isLong);
    event PositionTokenBurned(uint256 indexed tokenId);
    event BaseURIUpdated(string newBaseURI);
    event TradingCoreUpdated(address indexed newTradingCore);
    event TransferFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TransferFeeCollected(uint256 indexed tokenId, address indexed from, address indexed to, uint256 fee);
    event OwnershipUpdateFailed(uint256 indexed tokenId, address indexed from, address indexed to);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        /* _disableInitializers(); */
    }

    function initialize(
        string memory name_, 
        string memory symbol_, 
        string memory baseURI_
    ) public initializer {
        __ERC721_init(name_, symbol_);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);

        baseTokenURI = baseURI_;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function setTradingCore(address _tradingCore) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_tradingCore == address(0)) revert ZeroAddress();
        tradingCore = _tradingCore;
        _grantRole(MINTER_ROLE, _tradingCore);
        emit TradingCoreUpdated(_tradingCore);
    }
    
    function setTransferFee(uint256 feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeBps > MAX_FEE_BPS) revert InvalidFee();
        if (feeBps > 0) revert TransferFeeNotSupported();
        uint256 oldFee = transferFeeBps;
        transferFeeBps = feeBps;
        emit TransferFeeUpdated(oldFee, feeBps);
    }
    
    function setFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = recipient;
        emit FeeRecipientUpdated(oldRecipient, recipient);
    }

    function setBaseURI(string memory newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function _checkNotContract(address to) private view {
        uint256 size;
        assembly {
            size := extcodesize(to)
        }
        if (size > 0 && !whitelistedContracts[to]) revert ContractRecipientNotAllowed();
    }
    
    function setContractWhitelist(address contractAddr, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (contractAddr == address(0)) revert ZeroAddress();
        whitelistedContracts[contractAddr] = allowed;
    }
    
    function mint(address, uint256) external view onlyRole(MINTER_ROLE) {
        revert UseCanonicalMint();
    }

    function mint(
        address to,
        uint256 positionId,
        address market,
        bool isLong
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        _checkNotContract(to);
        tokenId = positionId;
        _safeMint(to, tokenId);
        
        _positionMarkets[tokenId] = market;
        _positionDirections[tokenId] = isLong;
        
        unchecked {
            totalMinted++;
        }
        _ownerPositions[to].push(tokenId);
        
        emit PositionTokenMinted(to, tokenId, market, isLong);
    }

    function burn(uint256 tokenId) external onlyRole(MINTER_ROLE) {
        address owner = _ownerOf(tokenId);
        _burn(tokenId);
        
        delete _positionMarkets[tokenId];
        delete _positionDirections[tokenId];
        
        unchecked {
            totalBurned++;
        }
        
        _removeFromOwnerPositions(owner, tokenId);
        
        emit PositionTokenBurned(tokenId);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override nonReentrant returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && tradingCore != address(0)) {
            try ITradingCore(tradingCore).updatePositionOwner(tokenId, to, from) {
            } catch Error(string memory reason) {
                revert TradingCoreUpdateFailed(reason);
            } catch {
                revert PositionOwnershipUpdateFailed();
            }
        }
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            _removeFromOwnerPositions(from, tokenId);
            _ownerPositions[to].push(tokenId);
        }
        return from;
    }
    
    function _removeFromOwnerPositions(address owner, uint256 tokenId) private {
        uint256[] storage positions = _ownerPositions[owner];
        uint256 len = positions.length;
        for (uint256 i = 0; i < len;) {
            if (positions[i] == tokenId) {
                positions[i] = positions[len - 1];
                positions.pop();
                break;
            }
            unchecked { ++i; }
        }
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return string(abi.encodePacked(_baseURI(), tokenId.toString()));
    }
    
    function getPositionMarket(uint256 tokenId) external view returns (address) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return _positionMarkets[tokenId];
    }
    
    function getPositionDirection(uint256 tokenId) external view returns (bool isLong) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return _positionDirections[tokenId];
    }
    
    function positionExists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
    
    function getPositionsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownerPositions[owner];
    }
    
    function totalSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
    }

    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        override(ERC721Upgradeable, AccessControlUpgradeable) 
        returns (bool) 
    {
        return super.supportsInterface(interfaceId);
    }
}
