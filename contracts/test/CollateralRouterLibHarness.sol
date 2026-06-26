// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/CollateralRouterLib.sol";
import "../core/CollateralRegistry.sol";

contract CollateralRouterLibHarness {
    function selectBestCollateral(
        address user,
        address[] memory tokens,
        address registryAddr,
        uint256 requiredUsdcValue,
        bool useLiquidationHaircut
    ) external view returns (address token, uint256 tokenAmount, uint256 usdcValue) {
        CollateralRegistry registry = CollateralRegistry(registryAddr);
        CollateralRouterLib.SelectionResult memory result = CollateralRouterLib.selectBestCollateral(
            user,
            tokens,
            registry,
            requiredUsdcValue,
            useLiquidationHaircut
        );
        return (result.token, result.tokenAmount, result.usdcValue);
    }

    function selectBestCollateralBasket(
        address user,
        address[] memory tokens,
        address registryAddr,
        uint256 requiredUsdcValue,
        bool useLiquidationHaircut
    )
        external
        view
        returns (
            address[] memory selectedTokens,
            uint256[] memory amounts,
            uint256[] memory usdcValues,
            uint256 totalUsdcValue
        )
    {
        CollateralRegistry registry = CollateralRegistry(registryAddr);
        DataTypes.BasketAllocation memory result = CollateralRouterLib.selectBestCollateralBasket(
            user,
            tokens,
            registry,
            requiredUsdcValue,
            useLiquidationHaircut
        );
        return (result.tokens, result.amounts, result.usdcValues, result.totalUsdcValue);
    }

    function getUserTotalCollateralValue(
        address user,
        address[] memory tokens,
        address registryAddr,
        bool useLiquidationHaircut
    ) external view returns (uint256) {
        CollateralRegistry registry = CollateralRegistry(registryAddr);
        return CollateralRouterLib.getUserTotalCollateralValue(user, tokens, registry, useLiquidationHaircut);
    }
}
