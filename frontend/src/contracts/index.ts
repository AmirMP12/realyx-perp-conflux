import type { Address } from "viem";
import TradingCoreAbi from "../abi/TradingCore.json";
import VaultCoreAbi from "../abi/VaultCore.json";
import OracleAggregatorAbi from "../abi/OracleAggregator.json";
import IPositionTokenAbi from "../abi/IPositionToken.json";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function envAddress(value: string | undefined, fallback: Address = ZERO): Address {
    const t = value?.trim();
    return (t || fallback) as Address;
}

export const TRADING_CORE_ADDRESS = envAddress(import.meta.env.VITE_TRADING_CORE_ADDRESS);
export const VAULT_CORE_ADDRESS = envAddress(import.meta.env.VITE_VAULT_CORE_ADDRESS);
export const ORACLE_AGGREGATOR_ADDRESS = envAddress(import.meta.env.VITE_ORACLE_AGGREGATOR_ADDRESS);
export const POSITION_TOKEN_ADDRESS = envAddress(import.meta.env.VITE_POSITION_TOKEN_ADDRESS);
/** Dev fallback = deployment/confluxTestnet.json `contracts.usdc` when using mock USDC. */
export const MOCK_USDC_ADDRESS = envAddress(
    import.meta.env.VITE_MOCK_USDC_ADDRESS,
    "0xa56Ba38f3c820D6cf31a68CBBD0d25c0F5644d35" as Address,
);

export const TRADING_CORE_ABI = TradingCoreAbi as any;
export const VAULT_ABI = VaultCoreAbi as any;
export const ORACLE_ABI = OracleAggregatorAbi as any;
/** Full ABI for position NFT transfers (`safeTransferFrom`, etc.). */
export const POSITION_TOKEN_ABI = IPositionTokenAbi as any;

export const getContractAddresses = () => ({
    tradingCore: TRADING_CORE_ADDRESS,
    vaultCore: VAULT_CORE_ADDRESS,
    oracleAggregator: ORACLE_AGGREGATOR_ADDRESS,
    positionToken: POSITION_TOKEN_ADDRESS,
});
