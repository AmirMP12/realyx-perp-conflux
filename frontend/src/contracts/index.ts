import type { Address } from "viem";
import TradingCoreAbi from "../abi/TradingCore.json";
import VaultCoreAbi from "../abi/VaultCore.json";
import OracleAggregatorAbi from "../abi/OracleAggregator.json";
import IPositionTokenAbi from "../abi/IPositionToken.json";
import CollateralRegistryAbi from "../abi/CollateralRegistry.json";
import CopyRegistryAbi from "../abi/CopyRegistry.json";
import ReferralRegistryAbi from "../abi/ReferralRegistry.json";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function envAddress(value: string | undefined, fallback: Address = ZERO): Address {
    const t = value?.trim();
    return (t || fallback) as Address;
}

export const TRADING_CORE_ADDRESS = envAddress(import.meta.env.VITE_TRADING_CORE_ADDRESS);
export const VAULT_CORE_ADDRESS = envAddress(import.meta.env.VITE_VAULT_CORE_ADDRESS);
export const ORACLE_AGGREGATOR_ADDRESS = envAddress(import.meta.env.VITE_ORACLE_AGGREGATOR_ADDRESS);
export const POSITION_TOKEN_ADDRESS = envAddress(import.meta.env.VITE_POSITION_TOKEN_ADDRESS);
export const COLLATERAL_REGISTRY_ADDRESS = envAddress(import.meta.env.VITE_COLLATERAL_REGISTRY_ADDRESS);
export const COPY_REGISTRY_ADDRESS = envAddress(import.meta.env.VITE_COPY_REGISTRY_ADDRESS);
export const REFERRAL_REGISTRY_ADDRESS = envAddress(import.meta.env.VITE_REFERRAL_REGISTRY_ADDRESS);

/**
 * Whether the deployed TradingCore accepts non-USDT0 collateral on `createOrder`.
 * The current eSpace deployment hard-reverts alt-collateral orders with
 * `AltCollateralDisabled()`, so this defaults to `false`. Flip it to `true`
 * (via `VITE_MULTI_COLLATERAL_ORDERS_ENABLED=true`) only once the contract
 * enables the alt-collateral path; the trading UI then lets users post margin
 * in any registered token. Until then the multi-collateral panels stay
 * informational (registry-driven) and orders settle in USDT0.
 */
export const MULTI_COLLATERAL_ORDERS_ENABLED =
    String(import.meta.env.VITE_MULTI_COLLATERAL_ORDERS_ENABLED ?? "").trim().toLowerCase() === "true";
/** Dev fallback = deployment/confluxTestnet.json `contracts.usdt0` when using mock USDT0. */
export const MOCK_USDT0_ADDRESS = envAddress(
    import.meta.env.VITE_MOCK_USDT0_ADDRESS,
    "0x85B9BA60D6Aef728c0Ea9C9f6709D31707dfC73A" as Address,
);

export const TRADING_CORE_ABI = TradingCoreAbi as any;
export const VAULT_ABI = VaultCoreAbi as any;
export const ORACLE_ABI = OracleAggregatorAbi as any;
/** Full ABI for position NFT transfers (`safeTransferFrom`, etc.). */
export const POSITION_TOKEN_ABI = IPositionTokenAbi as any;
export const COLLATERAL_REGISTRY_ABI = CollateralRegistryAbi as any;
export const COPY_REGISTRY_ABI = CopyRegistryAbi as any;
export const REFERRAL_REGISTRY_ABI = ReferralRegistryAbi as any;

export const getContractAddresses = () => ({
    tradingCore: TRADING_CORE_ADDRESS,
    vaultCore: VAULT_CORE_ADDRESS,
    oracleAggregator: ORACLE_AGGREGATOR_ADDRESS,
    positionToken: POSITION_TOKEN_ADDRESS,
    collateralRegistry: COLLATERAL_REGISTRY_ADDRESS,
    copyRegistry: COPY_REGISTRY_ADDRESS,
    referralRegistry: REFERRAL_REGISTRY_ADDRESS,
});
