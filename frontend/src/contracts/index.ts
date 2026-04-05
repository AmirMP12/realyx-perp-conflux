/**
 * Contract addresses and configuration
 * Load from env so a single build can target different networks via .env
 */
export const getContractAddresses = () => ({
    tradingCore: (import.meta.env.VITE_TRADING_CORE_ADDRESS || '') as `0x${string}`,
    vaultCore: (import.meta.env.VITE_VAULT_CORE_ADDRESS || '') as `0x${string}`,
    oracleAggregator: (import.meta.env.VITE_ORACLE_AGGREGATOR_ADDRESS || '') as `0x${string}`,
    positionToken: (import.meta.env.VITE_POSITION_TOKEN_ADDRESS || '') as `0x${string}`,
});

export const TRADING_CORE_ADDRESS = getContractAddresses().tradingCore;
export const VAULT_CORE_ADDRESS = getContractAddresses().vaultCore;
export const ORACLE_AGGREGATOR_ADDRESS = getContractAddresses().oracleAggregator;
export const POSITION_TOKEN_ADDRESS = getContractAddresses().positionToken;
