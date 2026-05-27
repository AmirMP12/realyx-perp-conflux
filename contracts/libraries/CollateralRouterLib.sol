// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "../core/CollateralRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CollateralRouterLib
 * @notice Smart collateral routing: selects the best collateral token from a user's holdings
 *         to meet a required USDC value, respecting per-token haircuts and protocol exposure caps.
 * @dev Library functions call CollateralRegistry for config and pricing.
 */
library CollateralRouterLib {
    uint256 private constant BPS = 10000;

    /// @notice Result of best-collateral selection.
    struct SelectionResult {
        address token;         // 0x0 if no single token suffices
        uint256 tokenAmount;   // Native token amount needed
        uint256 usdcValue;     // USDC-equivalent value (after haircut)
    }

    /// @notice Select the best single collateral token from a user's balances.
    function selectBestCollateral(
        address user,
        address[] memory tokens,
        CollateralRegistry registry,
        uint256 requiredUsdcValue,
        bool useLiquidationHaircut
    ) internal view returns (SelectionResult memory result) {
        uint256 bestExcess = 0;
        uint256 bestTokenAmount = 0;
        uint256 bestUsdcValue = 0;
        address bestToken = address(0);

        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; ) {
            address token = tokens[i];
            CollateralRegistry.CollateralConfig memory cfg = registry.getCollateralConfig(token);

            if (!cfg.enabled) {
                unchecked { ++i; }
                continue;
            }

            uint256 balance;
            if (token == address(0)) {
                balance = 0; // Handled as mock for USDC if token address is 0x0 but typically USDC has an address. Wait, in this protocol, address(0) is used as USDC sometimes? 
                // Ah, CollateralRegistry uses address(0) for USDC. But IERC20(address(0)).balanceOf(user) will revert!
                // Wait, if token == address(0), it implies Native ETH or a special USDC representation? 
                // Wait, if USDC is address(0), we can't call balanceOf. Let's assume actual ERC20 addresses are provided, and address(0) is a mock in CollateralRegistry.
                // Wait, the previous CollateralRouterLib did: `uint256 balance = IERC20(token).balanceOf(user);` directly without checking `token == address(0)`. So `tokens` array does not contain `address(0)`.
            }
            balance = IERC20(token).balanceOf(user);
            
            if (balance == 0) {
                unchecked { ++i; }
                continue;
            }

            uint256 balanceUsdcValue;
            try registry.getCollateralValue(token, balance, useLiquidationHaircut) returns (uint256 val) {
                balanceUsdcValue = val;
            } catch {
                unchecked { ++i; }
                continue;
            }

            if (balanceUsdcValue < requiredUsdcValue) {
                unchecked { ++i; }
                continue;
            }

            uint256 neededTokenAmount;
            try registry.getTokenAmountForUsdc(token, requiredUsdcValue, useLiquidationHaircut) returns (uint256 amt) {
                neededTokenAmount = amt;
            } catch {
                unchecked { ++i; }
                continue;
            }

            if (neededTokenAmount > balance) {
                unchecked { ++i; }
                continue;
            }

            uint256 neededUsdcValue;
            try registry.getCollateralValue(token, neededTokenAmount, useLiquidationHaircut) returns (uint256 val) {
                neededUsdcValue = val;
            } catch {
                unchecked { ++i; }
                continue;
            }

            uint256 excess = balanceUsdcValue - neededUsdcValue;
            bool better = (bestToken == address(0)) ||
                (excess > bestExcess) ||
                (excess == bestExcess && neededTokenAmount < bestTokenAmount);

            if (better) {
                bestToken = token;
                bestTokenAmount = neededTokenAmount;
                bestUsdcValue = neededUsdcValue;
                bestExcess = excess;
            }

            unchecked { ++i; }
        }

        result.token = bestToken;
        result.tokenAmount = bestTokenAmount;
        result.usdcValue = bestUsdcValue;
    }

    /// @notice Selects the best collateral basket, falling back to split-fill if no single token suffices.
    function selectBestCollateralBasket(
        address user,
        address[] memory tokens,
        CollateralRegistry registry,
        uint256 requiredUsdcValue,
        bool useLiquidationHaircut
    ) internal view returns (DataTypes.BasketAllocation memory allocation) {
        SelectionResult memory singleResult = selectBestCollateral(user, tokens, registry, requiredUsdcValue, useLiquidationHaircut);
        if (singleResult.token != address(0)) {
            address[] memory t = new address[](1);
            t[0] = singleResult.token;
            uint256[] memory a = new uint256[](1);
            a[0] = singleResult.tokenAmount;
            uint256[] memory u = new uint256[](1);
            u[0] = singleResult.usdcValue;
            return DataTypes.BasketAllocation(t, a, u, singleResult.usdcValue);
        }

        uint256 len = tokens.length;
        address[] memory tempTokens = new address[](len);
        uint256[] memory tempAmounts = new uint256[](len);
        uint256[] memory tempUsdc = new uint256[](len);
        uint256 count = 0;
        uint256 remainingUsdc = requiredUsdcValue;
        uint256 totalUsdc = 0;

        for (uint256 i = 0; i < len && remainingUsdc > 0; i++) {
            address token = tokens[i];
            CollateralRegistry.CollateralConfig memory cfg = registry.getCollateralConfig(token);
            if (!cfg.enabled) continue;

            uint256 balance = IERC20(token).balanceOf(user);
            if (balance == 0) continue;

            uint256 balanceUsdcValue;
            try registry.getCollateralValue(token, balance, useLiquidationHaircut) returns (uint256 val) {
                balanceUsdcValue = val;
            } catch {
                continue;
            }

            if (balanceUsdcValue == 0) continue;

            if (balanceUsdcValue >= remainingUsdc) {
                uint256 neededAmt;
                try registry.getTokenAmountForUsdc(token, remainingUsdc, useLiquidationHaircut) returns (uint256 amt) {
                    neededAmt = amt;
                } catch {
                    continue;
                }
                
                if (neededAmt > balance) neededAmt = balance;
                
                uint256 neededUsdc;
                try registry.getCollateralValue(token, neededAmt, useLiquidationHaircut) returns (uint256 val) {
                    neededUsdc = val;
                } catch {
                    continue;
                }

                tempTokens[count] = token;
                tempAmounts[count] = neededAmt;
                tempUsdc[count] = neededUsdc;
                count++;
                totalUsdc += neededUsdc;
                remainingUsdc = 0;
            } else {
                tempTokens[count] = token;
                tempAmounts[count] = balance;
                tempUsdc[count] = balanceUsdcValue;
                count++;
                totalUsdc += balanceUsdcValue;
                remainingUsdc -= balanceUsdcValue;
            }
        }

        address[] memory finalTokens = new address[](count);
        uint256[] memory finalAmounts = new uint256[](count);
        uint256[] memory finalUsdc = new uint256[](count);
        for(uint256 i = 0; i < count; i++) {
            finalTokens[i] = tempTokens[i];
            finalAmounts[i] = tempAmounts[i];
            finalUsdc[i] = tempUsdc[i];
        }

        return DataTypes.BasketAllocation(finalTokens, finalAmounts, finalUsdc, totalUsdc);
    }

    /// @notice Compute the USDC-equivalent value of a user's total collateral across all registered tokens.
    function getUserTotalCollateralValue(
        address user,
        address[] memory tokens,
        CollateralRegistry registry,
        bool useLiquidationHaircut
    ) internal view returns (uint256 totalUsdcValue) {
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; ) {
            address token = tokens[i];
            CollateralRegistry.CollateralConfig memory cfg = registry.getCollateralConfig(token);
            if (!cfg.enabled) {
                unchecked { ++i; }
                continue;
            }
            uint256 balance = IERC20(token).balanceOf(user);
            if (balance > 0) {
                try registry.getCollateralValue(token, balance, useLiquidationHaircut) returns (uint256 val) {
                    totalUsdcValue += val;
                } catch {
                }
            }
            unchecked { ++i; }
        }
    }
}