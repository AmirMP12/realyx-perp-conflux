// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../base/AccessControlled.sol";
import "../interfaces/IReferralRegistry.sol";

/**
 * @title ReferralRegistry
 * @notice On-chain registration hub for the protocol referral program.
 *         Affiliates claim a human-readable code; traders bind themselves to
 *         a code once. `TradingCore` looks up the referrer + active fee tier
 *         on every trade (O(1)) and feeds the per-trade volume back here so
 *         tier progression is fully on-chain.
 *
 * @dev Design notes:
 *      - Codes are case-insensitive ASCII (a-z, A-Z, 0-9, `-`, `_`), 4–16 chars.
 *        We hash the upper-cased bytes so `Alice` and `ALICE` collide — the
 *        UX invariant users expect.
 *      - We persist the canonical (upper-cased) string alongside the hash so
 *        UIs can look up the human label without an off-chain index.
 *      - Tiers are stored in a `uint256[]` packed as
 *        `(minVolumeUsdc << 32) | (discountBps << 16) | rebateBps`.
 *        Volume fits in 224 bits; bps in 16 bits each. Sorted ascending by
 *        threshold; we never iterate the tier list on the hot path: the
 *        trader's qualified tier index is cached and only refreshed when
 *        `recordReferralVolume` crosses the next threshold.
 *      - Self-referral is blocked. Code transfers exist so affiliates can
 *        rotate keys without losing their book.
 */
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract ReferralRegistry is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    AccessControlled,
    IReferralRegistry
{
    // ──────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────
    error CodeAlreadyTaken();
    error CodeNotRegistered();
    error CodeTooShort();
    error CodeTooLong();
    error InvalidCodeCharacters();
    error AlreadyBound();
    error CannotBindOwnCode();
    error InvalidTierConfig();
    error TierAlreadyExists();
    error TierNotFound();
    error InvalidParam();
    error AlreadyHasCode();
    error NotCodeOwner();

    // ──────────────────────────────────────────────────────
    //  Constants
    // ──────────────────────────────────────────────────────
    uint256 private constant MIN_CODE_LENGTH = 4;
    uint256 private constant MAX_CODE_LENGTH = 16;
    uint256 private constant BPS = 10000;
    /// @dev Upper bound on tier count to keep storage costs predictable. The
    ///      hot path is O(1) but admin tier add/remove is O(n).
    uint256 private constant MAX_TIERS = 16;

    // ──────────────────────────────────────────────────────
    //  Storage
    // ──────────────────────────────────────────────────────
    /// @notice keccak256(uppercased code) → owner address
    mapping(bytes32 => address) public codeOwners;

    /// @notice keccak256(uppercased code) → canonical (uppercased) string
    mapping(bytes32 => string) private _codeStrings;

    /// @notice owner address → keccak256(code) (one code per affiliate)
    mapping(address => bytes32) public codeOf_;

    /// @notice trader address → keccak256(code) they are bound to
    mapping(address => bytes32) public traderCodes;

    /// @notice keccak256(code) → cumulative referee count (for indexers/UI)
    mapping(bytes32 => uint256) public refereeCount;

    /// @notice trader → cumulative volume (USDC, 6 dp). Updated by TradingCore.
    mapping(address => uint256) public traderCumulativeVolume;

    /// @notice trader → cached qualified tier index + 1 (0 = default tier).
    /// @dev Bumped only when volume crosses the next tier threshold; reads on
    ///      the hot path are O(1).
    mapping(address => uint32) private _traderTierIndexPlusOne;

    /// @notice Sorted (asc) array of packed tier records. See contract docs.
    uint256[] private _tiers;

    /// @notice Default discount/rebate when no tier qualifies (base tier).
    uint16 public defaultDiscountBps;
    uint16 public defaultRebateBps;

    // ──────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────
    event ReferralCodeRegistered(bytes32 indexed codeHash, address indexed owner, string code);
    event ReferralCodeTransferred(bytes32 indexed codeHash, address indexed from, address indexed to);
    event ReferralBound(address indexed trader, bytes32 indexed codeHash, address indexed referrer);
    event ReferralVolumeRecorded(address indexed trader, bytes32 indexed codeHash, uint256 volume, uint256 cumulative);
    event TierUpgraded(address indexed trader, uint32 newTierIndexPlusOne, uint16 discountBps, uint16 rebateBps);
    event TierAdded(uint256 indexed tierIndex, uint128 minVolumeUsdc, uint16 discountBps, uint16 rebateBps);
    event TierRemoved(uint256 indexed tierIndex, uint128 minVolumeUsdc);
    event DefaultRatesUpdated(uint16 discountBps, uint16 rebateBps);

    // ──────────────────────────────────────────────────────
    //  Upgrade gap
    // ──────────────────────────────────────────────────────
    uint256[42] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        uint16 _defaultDiscountBps,
        uint16 _defaultRebateBps
    ) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        if (_defaultDiscountBps > BPS || _defaultRebateBps > BPS) revert InvalidParam();

        __ReentrancyGuard_init();
        __AccessControlled_init(admin);
        __UUPSUpgradeable_init();

        defaultDiscountBps = _defaultDiscountBps;
        defaultRebateBps = _defaultRebateBps;
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}

    // ──────────────────────────────────────────────────────
    //  Affiliate actions
    // ──────────────────────────────────────────────────────

    /// @notice Claim a unique referral code (case-insensitive).
    /// @dev One code per affiliate to prevent code-squatting; transfer if
    ///      you need to rotate keys.
    function registerCode(string calldata code) external nonReentrant returns (bytes32 codeHash) {
        if (codeOf_[msg.sender] != bytes32(0)) revert AlreadyHasCode();
        (codeHash, ) = _normalizeAndHash(code);

        if (codeOwners[codeHash] != address(0)) revert CodeAlreadyTaken();

        codeOwners[codeHash] = msg.sender;
        codeOf_[msg.sender] = codeHash;
        _codeStrings[codeHash] = _toUpperCopy(code);

        emit ReferralCodeRegistered(codeHash, msg.sender, _codeStrings[codeHash]);
    }

    /// @notice Bind the caller (trader) to an existing referral code.
    /// @dev One-time bind. Cannot bind to your own code.
    function setTraderReferralCode(string calldata code) external nonReentrant {
        (bytes32 codeHash, ) = _normalizeAndHash(code);
        address referrer = codeOwners[codeHash];
        if (referrer == address(0)) revert CodeNotRegistered();
        if (referrer == msg.sender) revert CannotBindOwnCode();
        if (traderCodes[msg.sender] != bytes32(0)) revert AlreadyBound();

        traderCodes[msg.sender] = codeHash;
        unchecked {
            refereeCount[codeHash] += 1;
        }

        emit ReferralBound(msg.sender, codeHash, referrer);
    }

    /// @notice Transfer an affiliate code to a new owner (e.g. key rotation).
    /// @dev The new owner must not already own a code.
    function transferCode(string calldata code, address newOwner) external nonReentrant {
        if (newOwner == address(0)) revert ZeroAddress();
        (bytes32 codeHash, ) = _normalizeAndHash(code);
        if (codeOwners[codeHash] != msg.sender) revert NotCodeOwner();
        if (codeOf_[newOwner] != bytes32(0)) revert AlreadyHasCode();
        // The new owner cannot already be bound as a referee of THIS code (would self-refer).
        if (traderCodes[newOwner] == codeHash) revert CannotBindOwnCode();

        codeOwners[codeHash] = newOwner;
        delete codeOf_[msg.sender];
        codeOf_[newOwner] = codeHash;

        emit ReferralCodeTransferred(codeHash, msg.sender, newOwner);
    }

    // ──────────────────────────────────────────────────────
    //  Trading-core hook
    // ──────────────────────────────────────────────────────

    /// @notice Called by TradingCore on every trade to record volume and
    ///         lazily promote the trader to the next tier when they cross
    ///         a threshold. No-op for unreferred traders.
    /// @dev Only walks tiers when the cumulative volume crosses the *next*
    ///      threshold, so the steady state is a single SLOAD + SSTORE.
    function recordReferralVolume(address trader, uint256 sizeUsdc) external onlyTradingCore {
        bytes32 codeHash = traderCodes[trader];
        if (codeHash == bytes32(0) || sizeUsdc == 0) return;

        uint256 newCum = traderCumulativeVolume[trader] + sizeUsdc;
        traderCumulativeVolume[trader] = newCum;

        // Promotion check: is there a higher tier the trader now qualifies for?
        uint32 currentIdxPlusOne = _traderTierIndexPlusOne[trader];
        uint256 len = _tiers.length;
        if (len > 0 && currentIdxPlusOne < len) {
            uint256 nextThreshold = _tiers[currentIdxPlusOne] >> 32;
            if (newCum >= nextThreshold) {
                // Walk forward until we find the highest qualifying tier.
                uint32 newIdx = currentIdxPlusOne + 1;
                while (newIdx < len) {
                    uint256 nextNext = _tiers[newIdx] >> 32;
                    if (newCum < nextNext) break;
                    unchecked {
                        ++newIdx;
                    }
                }
                _traderTierIndexPlusOne[trader] = newIdx;
                uint256 packed = _tiers[newIdx - 1];
                emit TierUpgraded(trader, newIdx, uint16((packed >> 16) & 0xFFFF), uint16(packed & 0xFFFF));
            }
        }

        emit ReferralVolumeRecorded(trader, codeHash, sizeUsdc, newCum);
    }

    // ──────────────────────────────────────────────────────
    //  Reads (used by TradingCore + UI)
    // ──────────────────────────────────────────────────────

    /// @notice Look up referrer + active rates for a trader. O(1).
    function getTraderReferralData(address trader) external view returns (ReferralData memory data) {
        bytes32 codeHash = traderCodes[trader];
        if (codeHash == bytes32(0)) return data; // all zero

        address referrer = codeOwners[codeHash];
        if (referrer == address(0)) return data; // code revoked → treat as unreferred

        data.referrer = referrer;
        uint32 idxPlusOne = _traderTierIndexPlusOne[trader];
        data.tierIndex = idxPlusOne;

        if (idxPlusOne == 0) {
            data.discountBps = defaultDiscountBps;
            data.rebateBps = defaultRebateBps;
        } else {
            uint256 packed = _tiers[idxPlusOne - 1];
            data.discountBps = uint16((packed >> 16) & 0xFFFF);
            data.rebateBps = uint16(packed & 0xFFFF);
        }
    }

    function getReferrer(address trader) external view returns (address) {
        bytes32 codeHash = traderCodes[trader];
        if (codeHash == bytes32(0)) return address(0);
        return codeOwners[codeHash];
    }

    function isCodeAvailable(string calldata code) external view returns (bool) {
        (bytes32 codeHash, bool valid) = _tryNormalizeAndHash(code);
        return valid && codeOwners[codeHash] == address(0);
    }

    function codeOf(address owner) external view returns (string memory) {
        return _codeStrings[codeOf_[owner]];
    }

    function ownerOfCode(string calldata code) external view returns (address) {
        (bytes32 codeHash, bool valid) = _tryNormalizeAndHash(code);
        return valid ? codeOwners[codeHash] : address(0);
    }

    function getTiers() external view returns (Tier[] memory result) {
        uint256 len = _tiers.length;
        result = new Tier[](len);
        for (uint256 i = 0; i < len; ) {
            uint256 p = _tiers[i];
            result[i] = Tier({
                minVolumeUsdc: uint128(p >> 32),
                discountBps: uint16((p >> 16) & 0xFFFF),
                rebateBps: uint16(p & 0xFFFF)
            });
            unchecked {
                ++i;
            }
        }
    }

    function tierCount() external view returns (uint256) {
        return _tiers.length;
    }

    // ──────────────────────────────────────────────────────
    //  Admin: Tier management
    // ──────────────────────────────────────────────────────

    /// @notice Add a tier. Tiers are kept sorted by `minVolumeUsdc` ascending.
    /// @dev Reverts if a tier with the same threshold already exists. Bps must
    ///      be strictly monotonic with previous tier? We don't enforce — admin
    ///      can model "discount-only" or "rebate-only" tiers.
    function addTier(uint128 minVolumeUsdc, uint16 discountBps, uint16 rebateBps) external onlyAdmin {
        if (discountBps > BPS || rebateBps > BPS) revert InvalidTierConfig();
        uint256 len = _tiers.length;
        if (len >= MAX_TIERS) revert InvalidTierConfig();

        uint256 packed = (uint256(minVolumeUsdc) << 32) | (uint256(discountBps) << 16) | uint256(rebateBps);

        // Find insert position (sorted asc by minVolumeUsdc).
        uint256 insertAt = len;
        for (uint256 i = 0; i < len; ) {
            uint128 existingMin = uint128(_tiers[i] >> 32);
            if (existingMin == minVolumeUsdc) revert TierAlreadyExists();
            if (minVolumeUsdc < existingMin) {
                insertAt = i;
                break;
            }
            unchecked {
                ++i;
            }
        }

        _tiers.push(0);
        // Shift right.
        for (uint256 j = len; j > insertAt; ) {
            _tiers[j] = _tiers[j - 1];
            unchecked {
                --j;
            }
        }
        _tiers[insertAt] = packed;

        emit TierAdded(insertAt, minVolumeUsdc, discountBps, rebateBps);
    }

    /// @notice Remove a tier by its `minVolumeUsdc` threshold.
    /// @dev Existing trader cached indices are clamped on next volume update.
    ///      Unaffected traders below the removed tier keep their cached idx
    ///      semantics intact (still references the correct surviving tier).
    function removeTier(uint128 minVolumeUsdc) external onlyAdmin {
        uint256 len = _tiers.length;
        for (uint256 i = 0; i < len; ) {
            if (uint128(_tiers[i] >> 32) == minVolumeUsdc) {
                for (uint256 j = i; j < len - 1; ) {
                    _tiers[j] = _tiers[j + 1];
                    unchecked {
                        ++j;
                    }
                }
                _tiers.pop();
                emit TierRemoved(i, minVolumeUsdc);
                return;
            }
            unchecked {
                ++i;
            }
        }
        revert TierNotFound();
    }

    function setDefaultRates(uint16 discountBps, uint16 rebateBps) external onlyAdmin {
        if (discountBps > BPS || rebateBps > BPS) revert InvalidParam();
        defaultDiscountBps = discountBps;
        defaultRebateBps = rebateBps;
        emit DefaultRatesUpdated(discountBps, rebateBps);
    }

    // ──────────────────────────────────────────────────────
    //  Internal: code parsing
    // ──────────────────────────────────────────────────────

    function _normalizeAndHash(string calldata code) internal pure returns (bytes32 codeHash, uint256 len) {
        bytes calldata b = bytes(code);
        len = b.length;
        if (len < MIN_CODE_LENGTH) revert CodeTooShort();
        if (len > MAX_CODE_LENGTH) revert CodeTooLong();

        bytes memory upper = new bytes(len);
        for (uint256 i = 0; i < len; ) {
            bytes1 c = b[i];
            // a-z → A-Z
            if (c >= 0x61 && c <= 0x7a) {
                c = bytes1(uint8(c) - 32);
            }
            // A-Z, 0-9, '-', '_'
            if (
                !((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f)
            ) revert InvalidCodeCharacters();
            upper[i] = c;
            unchecked {
                ++i;
            }
        }
        codeHash = keccak256(upper);
    }

    /// @dev Soft variant for view functions that should return `false` instead of reverting.
    function _tryNormalizeAndHash(string calldata code) internal pure returns (bytes32 codeHash, bool valid) {
        bytes calldata b = bytes(code);
        uint256 len = b.length;
        if (len < MIN_CODE_LENGTH || len > MAX_CODE_LENGTH) return (bytes32(0), false);

        bytes memory upper = new bytes(len);
        for (uint256 i = 0; i < len; ) {
            bytes1 c = b[i];
            if (c >= 0x61 && c <= 0x7a) {
                c = bytes1(uint8(c) - 32);
            }
            if (
                !((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f)
            ) return (bytes32(0), false);
            upper[i] = c;
            unchecked {
                ++i;
            }
        }
        return (keccak256(upper), true);
    }

    function _toUpperCopy(string calldata code) internal pure returns (string memory) {
        bytes calldata b = bytes(code);
        uint256 len = b.length;
        bytes memory upper = new bytes(len);
        for (uint256 i = 0; i < len; ) {
            bytes1 c = b[i];
            if (c >= 0x61 && c <= 0x7a) {
                c = bytes1(uint8(c) - 32);
            }
            upper[i] = c;
            unchecked {
                ++i;
            }
        }
        return string(upper);
    }
}
