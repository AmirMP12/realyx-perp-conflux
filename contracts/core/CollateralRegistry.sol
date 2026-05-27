// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IOracleAggregator.sol";

/**
 * @title CollateralRegistry
 * @notice Manages a basket of collateral tokens with dynamic per-token haircuts,
 *         oracle-based valuation, and smart routing hooks.
 */
contract CollateralRegistry is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant TRADING_CORE_ROLE = keccak256("TRADING_CORE_ROLE");

    struct CollateralConfig {
        bool enabled;
        uint16 baseHaircutBps;          // standard discount (e.g. 200 = 2%)
        uint16 liquidationHaircutBps;   // liquidation discount (e.g. 500 = 5%), 0 means use dynamic
        uint16 maxHaircutBps;           // cap for dynamic haircut (e.g. 3000 = 30%)
        uint16 utilizationSlopeBps;     // extra BPS per 10% utilization
        uint16 volatilityAdderBps;      // extra BPS when oracle confidence > 1%
        uint256 maxProtocolExposure;    // cap on total USDC-equivalent value deposited (6 decimals)
        address oracleFeed;             // Oracle Aggregator market address for price
        uint8 decimals;                 // token decimals
    }

    IOracleAggregator public oracleAggregator;
    mapping(address => CollateralConfig) public collaterals; // token → config
    address[] public registeredTokens;
    mapping(address => uint256) public totalDeposited; // token → raw deposited amount

    event TokenRegistered(address indexed token, uint16 baseHaircutBps, uint16 liquidationHaircutBps, uint256 maxExposure, address oracleFeed);
    event TokenUpdated(address indexed token, uint16 baseHaircutBps, uint16 liquidationHaircutBps, uint256 maxExposure);
    event TokenPaused(address indexed token, bool paused);
    event DepositRecorded(address indexed token, uint256 rawAmount);
    event WithdrawalRecorded(address indexed token, uint256 rawAmount);

    error TokenAlreadyRegistered();
    error TokenNotRegistered();
    error TokenDisabled();
    error ZeroAddress();
    error InvalidHaircut();
    error ExceedsMaxExposure();
    error InvalidParam();
    error InvalidOraclePrice();

    constructor(address admin, address _oracleAggregator) {
        if (admin == address(0) || _oracleAggregator == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        oracleAggregator = IOracleAggregator(_oracleAggregator);
    }

    // ─── Registration & Management ──────────────────────────────

    function registerToken(
        address token,
        uint16 baseHaircutBps,
        uint16 liquidationHaircutBps,
        uint16 maxHaircutBps,
        uint16 utilizationSlopeBps,
        uint16 volatilityAdderBps,
        uint256 maxProtocolExposure,
        address oracleFeed,
        uint8 decimals
    ) external onlyRole(OPERATOR_ROLE) {
        if (token == address(0) || oracleFeed == address(0)) revert ZeroAddress();
        if (baseHaircutBps > 10000 || liquidationHaircutBps > 10000 || maxHaircutBps > 10000) revert InvalidHaircut();
        if (collaterals[token].oracleFeed != address(0)) revert TokenAlreadyRegistered();

        collaterals[token] = CollateralConfig({
            enabled: true,
            baseHaircutBps: baseHaircutBps,
            liquidationHaircutBps: liquidationHaircutBps,
            maxHaircutBps: maxHaircutBps,
            utilizationSlopeBps: utilizationSlopeBps,
            volatilityAdderBps: volatilityAdderBps,
            maxProtocolExposure: maxProtocolExposure,
            oracleFeed: oracleFeed,
            decimals: decimals
        });
        registeredTokens.push(token);
        emit TokenRegistered(token, baseHaircutBps, liquidationHaircutBps, maxProtocolExposure, oracleFeed);
    }

    function setHaircut(
        address token, 
        uint16 baseHaircutBps, 
        uint16 liquidationHaircutBps, 
        uint16 maxHaircutBps,
        uint16 utilizationSlopeBps,
        uint16 volatilityAdderBps
    ) external onlyRole(OPERATOR_ROLE) {
        CollateralConfig storage cfg = collaterals[token];
        if (cfg.oracleFeed == address(0)) revert TokenNotRegistered();
        if (baseHaircutBps > 10000 || liquidationHaircutBps > 10000 || maxHaircutBps > 10000) revert InvalidHaircut();
        cfg.baseHaircutBps = baseHaircutBps;
        cfg.liquidationHaircutBps = liquidationHaircutBps;
        cfg.maxHaircutBps = maxHaircutBps;
        cfg.utilizationSlopeBps = utilizationSlopeBps;
        cfg.volatilityAdderBps = volatilityAdderBps;
        emit TokenUpdated(token, baseHaircutBps, liquidationHaircutBps, cfg.maxProtocolExposure);
    }

    function setMaxExposure(address token, uint256 maxExposure) external onlyRole(OPERATOR_ROLE) {
        CollateralConfig storage cfg = collaterals[token];
        if (cfg.oracleFeed == address(0)) revert TokenNotRegistered();
        cfg.maxProtocolExposure = maxExposure;
        emit TokenUpdated(token, cfg.baseHaircutBps, cfg.liquidationHaircutBps, maxExposure);
    }

    function setTokenEnabled(address token, bool enabled) external onlyRole(OPERATOR_ROLE) {
        CollateralConfig storage cfg = collaterals[token];
        if (cfg.oracleFeed == address(0)) revert TokenNotRegistered();
        cfg.enabled = enabled;
        emit TokenPaused(token, !enabled);
    }

    function getRegisteredTokens() external view returns (address[] memory) {
        return registeredTokens;
    }

    function getCollateralConfig(address token) external view returns (CollateralConfig memory) {
        return collaterals[token];
    }

    // ─── Dynamic Haircut Calculation ────────────────────────────

    function getEffectiveHaircut(address token, uint256 confidence, uint256 price) public view returns (uint16) {
        if (token == address(0)) return 0; // USDC
        CollateralConfig storage cfg = collaterals[token];
        
        uint16 haircut = cfg.baseHaircutBps;

        if (cfg.maxProtocolExposure > 0 && cfg.utilizationSlopeBps > 0 && price > 0) {
            uint256 grossUsdc = (totalDeposited[token] * price) / (10 ** (cfg.decimals + 12));
            uint256 utilizationPercent = (grossUsdc * 100) / cfg.maxProtocolExposure;
            uint256 utilizationAdder = (utilizationPercent / 10) * cfg.utilizationSlopeBps;
            haircut += uint16(utilizationAdder);
        }

        if (cfg.volatilityAdderBps > 0 && price > 0) {
            if (confidence > price / 100) {
                haircut += cfg.volatilityAdderBps;
            }
        }

        return haircut > cfg.maxHaircutBps ? cfg.maxHaircutBps : haircut;
    }

    // ─── Valuation ──────────────────────────────────────────────

    /// @notice Returns the USDC-equivalent value of `amount` raw tokens (in 6 decimals).
    function getCollateralValue(
        address token,
        uint256 amount,
        bool useLiquidationHaircut
    ) public view returns (uint256 effectiveUsdcValue) {
        if (token == address(0)) return amount;
        CollateralConfig storage cfg = collaterals[token];
        if (!cfg.enabled) revert TokenDisabled();

        (uint256 price, uint256 conf, ) = oracleAggregator.getPrice(cfg.oracleFeed);
        if (price == 0) revert InvalidOraclePrice();

        uint256 grossUsdc = (amount * price) / (10 ** (cfg.decimals + 12));

        uint16 haircut = useLiquidationHaircut && cfg.liquidationHaircutBps > 0 
            ? cfg.liquidationHaircutBps 
            : getEffectiveHaircut(token, conf, price);

        effectiveUsdcValue = (grossUsdc * (10000 - haircut)) / 10000;
    }

    /// @notice Returns the raw token amount needed to meet a `usdcValue` requirement.
    function getTokenAmountForUsdc(
        address token,
        uint256 usdcValue,
        bool useLiquidationHaircut
    ) public view returns (uint256 amount) {
        if (token == address(0)) return usdcValue;
        CollateralConfig storage cfg = collaterals[token];
        if (!cfg.enabled) revert TokenDisabled();

        (uint256 price, uint256 conf, ) = oracleAggregator.getPrice(cfg.oracleFeed);
        if (price == 0) revert InvalidOraclePrice();

        uint16 haircut = useLiquidationHaircut && cfg.liquidationHaircutBps > 0 
            ? cfg.liquidationHaircutBps 
            : getEffectiveHaircut(token, conf, price);

        uint256 numerator = usdcValue * 10000 * (10 ** (cfg.decimals + 12));
        uint256 denominator = price * (10000 - haircut);
        amount = (numerator + denominator - 1) / denominator; // round up
    }

    // ─── Protocol exposure tracking ─────────────────────────────

    function recordDeposit(address token, uint256 rawAmount) external onlyRole(TRADING_CORE_ROLE) {
        if (token == address(0)) return;
        CollateralConfig storage cfg = collaterals[token];
        if (!cfg.enabled) revert TokenDisabled();
        
        uint256 newTotal = totalDeposited[token] + rawAmount;
        if (cfg.maxProtocolExposure > 0) {
            uint256 effective = getCollateralValue(token, newTotal, false);
            if (effective > cfg.maxProtocolExposure) revert ExceedsMaxExposure();
        }
        totalDeposited[token] = newTotal;
        emit DepositRecorded(token, rawAmount);
    }

    function recordWithdrawal(address token, uint256 rawAmount) external onlyRole(TRADING_CORE_ROLE) {
        if (token == address(0)) return;
        totalDeposited[token] -= rawAmount;
        emit WithdrawalRecorded(token, rawAmount);
    }
}