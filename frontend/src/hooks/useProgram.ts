import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSound } from './useSound';
import { type Address, formatUnits, parseUnits } from 'viem';

export const TRADING_CORE_ADDRESS = (import.meta.env.VITE_TRADING_CORE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;
export const VAULT_CORE_ADDRESS = (import.meta.env.VITE_VAULT_CORE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;
export const ORACLE_AGGREGATOR_ADDRESS = (import.meta.env.VITE_ORACLE_AGGREGATOR_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;

export const MOCK_USDC_ADDRESS: Address = (import.meta.env.VITE_MOCK_USDC_ADDRESS ?? '0x14D21f963EA8a644235Dd4d9D643437310cB4DeF') as Address;

const ERC20_ABI = [
    { "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "name": "owner", "type": "address" }, { "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;

export const TRADING_CORE_ABI = [
    {
        "inputs": [],
        "name": "usdc",
        "outputs": [{ "internalType": "contract IERC20", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{
            "components": [
                { "internalType": "address", "name": "market", "type": "address" },
                { "internalType": "uint256", "name": "size", "type": "uint256" },
                { "internalType": "uint256", "name": "leverage", "type": "uint256" },
                { "internalType": "bool", "name": "isLong", "type": "bool" },
                { "internalType": "bool", "name": "isCrossMargin", "type": "bool" },
                { "internalType": "uint256", "name": "stopLossPrice", "type": "uint256" },
                { "internalType": "uint256", "name": "takeProfitPrice", "type": "uint256" },
                { "internalType": "uint256", "name": "trailingStopBps", "type": "uint256" },
                { "internalType": "uint256", "name": "expectedPrice", "type": "uint256" },
                { "internalType": "uint256", "name": "maxSlippageBps", "type": "uint256" },
                { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                { "internalType": "enum DataTypes.CollateralType", "name": "collateralType", "type": "uint8" }
            ], "internalType": "struct DataTypes.OpenPositionParams", "name": "p", "type": "tuple"
        }],
        "name": "openPosition",
        "outputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "bytes32", "name": "h", "type": "bytes32" },
            { "internalType": "address", "name": "m", "type": "address" }
        ],
        "name": "commitOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "address", "name": "market", "type": "address" },
                    { "internalType": "uint256", "name": "size", "type": "uint256" },
                    { "internalType": "uint256", "name": "leverage", "type": "uint256" },
                    { "internalType": "bool", "name": "isLong", "type": "bool" },
                    { "internalType": "bool", "name": "isCrossMargin", "type": "bool" },
                    { "internalType": "uint256", "name": "stopLossPrice", "type": "uint256" },
                    { "internalType": "uint256", "name": "takeProfitPrice", "type": "uint256" },
                    { "internalType": "uint256", "name": "trailingStopBps", "type": "uint256" },
                    { "internalType": "uint256", "name": "expectedPrice", "type": "uint256" },
                    { "internalType": "uint256", "name": "maxSlippageBps", "type": "uint256" },
                    { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                    { "internalType": "enum DataTypes.CollateralType", "name": "collateralType", "type": "uint8" }
                ], "internalType": "struct DataTypes.OpenPositionParams", "name": "p", "type": "tuple"
            },
            { "internalType": "bytes32", "name": "s", "type": "bytes32" }
        ],
        "name": "revealOrder",
        "outputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "u", "type": "address" }],
        "name": "getUserPositions",
        "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
        "name": "getPosition",
        "outputs": [{
            "components": [
                { "internalType": "uint128", "name": "size", "type": "uint128" },
                { "internalType": "uint128", "name": "entryPrice", "type": "uint128" },
                { "internalType": "uint128", "name": "liquidationPrice", "type": "uint128" },
                { "internalType": "uint128", "name": "stopLossPrice", "type": "uint128" },
                { "internalType": "uint128", "name": "takeProfitPrice", "type": "uint128" },
                { "internalType": "uint64", "name": "leverage", "type": "uint64" },
                { "internalType": "uint64", "name": "lastFundingTime", "type": "uint64" },
                { "internalType": "address", "name": "market", "type": "address" },
                { "internalType": "uint40", "name": "openTimestamp", "type": "uint40" },
                { "internalType": "uint16", "name": "trailingStopBps", "type": "uint16" },
                { "internalType": "uint8", "name": "flags", "type": "uint8" },
                { "internalType": "enum DataTypes.CollateralType", "name": "collateralType", "type": "uint8" },
                { "internalType": "enum DataTypes.PositionState", "name": "state", "type": "uint8" }
            ], "internalType": "struct DataTypes.Position", "name": "", "type": "tuple"
        }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
        "name": "getPositionPnL",
        "outputs": [
            { "internalType": "int256", "name": "pnl", "type": "int256" },
            { "internalType": "uint256", "name": "hf", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minExecutionFee",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint8", "name": "orderType", "type": "uint8" },
            { "internalType": "address", "name": "market", "type": "address" },
            { "internalType": "uint256", "name": "sizeDelta", "type": "uint256" },
            { "internalType": "uint256", "name": "collateralDelta", "type": "uint256" },
            { "internalType": "uint256", "name": "triggerPrice", "type": "uint256" },
            { "internalType": "bool", "name": "isLong", "type": "bool" },
            { "internalType": "uint256", "name": "maxSlippage", "type": "uint256" },
            { "internalType": "uint256", "name": "positionId", "type": "uint256" }
        ],
        "name": "createOrder",
        "outputs": [{ "internalType": "uint256", "name": "orderId", "type": "uint256" }],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "id", "type": "uint256" },
            { "internalType": "uint256", "name": "amt", "type": "uint256" },
            { "internalType": "uint256", "name": "maxLev", "type": "uint256" },
            { "internalType": "bool", "name": "emg", "type": "bool" }
        ],
        "name": "addCollateral",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "id", "type": "uint256" },
            { "internalType": "uint256", "name": "amt", "type": "uint256" }
        ],
        "name": "withdrawCollateral",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "uint256", "name": "positionId", "type": "uint256" },
                    { "internalType": "uint256", "name": "closeSize", "type": "uint256" },
                    { "internalType": "uint256", "name": "minReceive", "type": "uint256" },
                    { "internalType": "uint256", "name": "deadline", "type": "uint256" }
                ], "internalType": "struct DataTypes.ClosePositionParams", "name": "p", "type": "tuple"
            }
        ],
        "name": "closePosition",
        "outputs": [{ "internalType": "int256", "name": "", "type": "int256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "m", "type": "address" }],
        "name": "getMarketInfo",
        "outputs": [
            {
                "components": [
                    { "internalType": "address", "name": "chainlinkFeed", "type": "address" },
                    { "internalType": "uint32", "name": "maxStaleness", "type": "uint32" },
                    { "internalType": "uint256", "name": "minConfidence", "type": "uint256" },
                    { "internalType": "uint64", "name": "maxLeverage", "type": "uint64" },
                    { "internalType": "uint128", "name": "maxPositionSize", "type": "uint128" },
                    { "internalType": "uint128", "name": "maxTotalExposure", "type": "uint128" },
                    { "internalType": "uint16", "name": "maintenanceMargin", "type": "uint16" },
                    { "internalType": "uint16", "name": "initialMargin", "type": "uint16" },
                    { "internalType": "bool", "name": "isActive", "type": "bool" },
                    { "internalType": "bool", "name": "isListed", "type": "bool" },
                    { "internalType": "uint128", "name": "totalLongSize", "type": "uint128" },
                    { "internalType": "uint128", "name": "totalShortSize", "type": "uint128" }
                ], "internalType": "struct DataTypes.Market", "name": "", "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "m", "type": "address" }],
        "name": "getFundingState",
        "outputs": [
            {
                "components": [
                    { "internalType": "uint256", "name": "cumulativeFundingLong", "type": "uint256" },
                    { "internalType": "uint256", "name": "cumulativeFundingShort", "type": "uint256" },
                    { "internalType": "uint256", "name": "lastFundingTime", "type": "uint256" },
                    { "internalType": "int256", "name": "fundingRate", "type": "int256" }
                ], "internalType": "struct DataTypes.FundingState", "name": "", "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "id", "type": "uint256" },
            { "internalType": "uint256", "name": "sl", "type": "uint256" }
        ],
        "name": "setStopLoss",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "id", "type": "uint256" },
            { "internalType": "uint256", "name": "tp", "type": "uint256" }
        ],
        "name": "setTakeProfit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "id", "type": "uint256" },
            { "internalType": "uint256", "name": "pct", "type": "uint256" },
            { "internalType": "uint256", "name": "minRcv", "type": "uint256" },
            { "internalType": "uint256", "name": "dl", "type": "uint256" }
        ],
        "name": "partialClose",
        "outputs": [{ "internalType": "int256", "name": "", "type": "int256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "id", "type": "uint256" },
            { "internalType": "uint256", "name": "bps", "type": "uint256" }
        ],
        "name": "setTrailingStop",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "orderId", "type": "uint256" }],
        "name": "cancelOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "usdc",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

export const ORACLE_ABI = [
    {
        "inputs": [{ "internalType": "address", "name": "token", "type": "address" }],
        "name": "getPrice",
        "outputs": [
            { "internalType": "uint256", "name": "", "type": "uint256" },
            { "internalType": "uint256", "name": "", "type": "uint256" },
            { "internalType": "uint256", "name": "", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

export const VAULT_ABI = [
    {
        "inputs": [],
        "name": "totalAssets",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "asset",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "assets", "type": "uint256" }, { "internalType": "address", "name": "receiver", "type": "address" }],
        "name": "deposit",
        "outputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }, { "internalType": "address", "name": "receiver", "type": "address" }, { "internalType": "address", "name": "owner", "type": "address" }],
        "name": "withdraw",
        "outputs": [{ "internalType": "uint256", "name": "assets", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
        "name": "lpBalanceOf",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "assets", "type": "uint256" }],
        "name": "previewDeposit",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }],
        "name": "previewWithdraw",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "assets", "type": "uint256" }],
        "name": "convertToShares",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getUtilization",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "accumulatedFees",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "lpTotalShares",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getAvailableLiquidity",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "insuranceAssets",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getInsuranceHealthRatio",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "isInsuranceHealthy",
        "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "insTotalShares",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
        "name": "insBalanceOf",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "insuranceCircuitBreakerActive",
        "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "assets", "type": "uint256" }, { "internalType": "address", "name": "receiver", "type": "address" }],
        "name": "stakeInsurance",
        "outputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }, { "internalType": "address", "name": "receiver", "type": "address" }],
        "name": "unstakeInsurance",
        "outputs": [{ "internalType": "uint256", "name": "assets", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

export interface OpenPositionParams {
    market: string;
    size: string; // wei
    leverage: string;
    isLong: boolean;
    isCrossMargin: boolean;
    stopLossPrice: string;
    takeProfitPrice: string;
    trailingStopBps: string;
    expectedPrice: string;
    maxSlippageBps: string;
    deadline: string;
    collateralType: number; // 0=USDC
}

export interface PositionData {
    id: number;
    size: number;
    marketAddress: string;
    leverage: number;
    entryPrice: number;
    liquidationPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    isLong: boolean;
    pnl: number;
    healthFactor: number;
    isOpen: boolean;
    margin: number;
    marketId: string;
}

/** OrderType enum on chain: 0=MARKET_INCREASE, 1=MARKET_DECREASE, 2=LIMIT_INCREASE, 3=LIMIT_DECREASE */
export const OrderType = { MARKET_INCREASE: 0, MARKET_DECREASE: 1, LIMIT_INCREASE: 2, LIMIT_DECREASE: 3 } as const;

export function useUSDC() {
    const { data: usdcAddress } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'usdc',
    });
    return { address: (usdcAddress as Address) || MOCK_USDC_ADDRESS };
}

/** User's USDC balance (6 decimals). Requires USDC address from useUSDC. */
export function useUSDCBalance() {
    const { address: userAddress } = useAccount();
    const { address: usdcAddress } = useUSDC();
    const { data: balanceWei, isLoading } = useReadContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: userAddress ? [userAddress] : undefined,
        query: { enabled: !!usdcAddress && !!userAddress, refetchInterval: 10000 },
    });
    const balance = balanceWei != null ? Number(formatUnits(balanceWei, 6)) : 0;
    return { balance, balanceWei, loading: isLoading };
}

/** Submit an order via TradingCore.createOrder. Execution is performed by a keeper (executeOrder). */
export function useCreateOrder() {
    const { address, chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const { data: minExecutionFeeWei } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'minExecutionFee',
    });

    const createOrder = async (params: {
        market: Address;
        sizeDelta: string; // 18 decimals (internal precision)
        collateralDelta: string;
        isLong: boolean;
        maxSlippage?: string;
        positionId?: number; // 0 for new position
        orderType?: number; // 0=MARKET_INCREASE, 1=MARKET_DECREASE, 2=LIMIT_INCREASE, 3=LIMIT_DECREASE
        triggerPriceWei?: string; // 18 decimals; required for LIMIT_*
    }) => {
        if (!address) throw new Error('Wallet not connected');
        if (minExecutionFeeWei === undefined) throw new Error('Execution fee not loaded yet. Please wait a moment.');

        const orderType = params.orderType ?? OrderType.MARKET_INCREASE;
        const triggerPriceWei = orderType === OrderType.LIMIT_INCREASE || orderType === OrderType.LIMIT_DECREASE
            ? BigInt(params.triggerPriceWei ?? '0')
            : 0n;
        const fee = minExecutionFeeWei;

        const orderId = await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'createOrder',
            args: [
                orderType,
                params.market,
                BigInt(params.sizeDelta),
                BigInt(params.collateralDelta),
                triggerPriceWei,
                params.isLong,
                BigInt(params.maxSlippage ?? '100'),
                BigInt(params.positionId ?? 0),
            ],
            value: fee,
        });
        return orderId;
    };

    return { createOrder, isPending, minExecutionFeeWei };
}

export function useOpenPosition() {
    const { address: usdcAddress } = useUSDC();
    const { address, chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const { createOrder } = useCreateOrder();

    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState<'IDLE' | 'APPROVING' | 'COMMITTING' | 'WAITING' | 'REVEALING'>('IDLE');

    const executePosition = async (
        params: Omit<OpenPositionParams, 'isCrossMargin' | 'collateralType' | 'deadline' | 'expectedPrice' | 'maxSlippageBps' | 'stopLossPrice' | 'takeProfitPrice' | 'trailingStopBps'> & {
            maxSlippageBps?: number,
            expectedPrice?: number,
            stopLossPrice?: string,
            takeProfitPrice?: string,
            trailingStopBps?: string,
            orderType?: number,
            triggerPrice?: string, // decimal string, e.g. "2500.50"
        }
    ) => {
        setIsLoading(true);
        setStep('IDLE');
        try {
            if (!address) throw new Error("Wallet not connected");

            const orderType = params.orderType ?? OrderType.MARKET_INCREASE;
            const isLimit = orderType === OrderType.LIMIT_INCREASE || orderType === OrderType.LIMIT_DECREASE;
            const triggerPriceStr = params.triggerPrice?.trim();
            if (isLimit && (!triggerPriceStr || parseFloat(triggerPriceStr) <= 0)) {
                throw new Error('Limit and stop orders require a trigger price');
            }

            const sizeNum = parseFloat(params.size);
            const leverageNum = parseFloat(params.leverage);

            // sizeDelta is in USDC – it IS the notional value, not an asset quantity.
            const notionalValue = sizeNum;

            // The smart contract assesses an opening fee (0.05% taker + min $0.10).
            // If the collateral doesn't cover this fee, `totalCollateralInternal <= openingFee` reverts!
            const baseMargin = leverageNum > 0 ? notionalValue / leverageNum : sizeNum;
            const estimatedOpeningFee = Math.max(0.10, notionalValue * 0.0005);
            const marginUSDC = baseMargin + estimatedOpeningFee;

            const sizeDelta6 = parseUnits(sizeNum.toFixed(6), 6);
            const collateralDelta18 = parseUnits(marginUSDC.toFixed(18), 18); // internal precision
            const triggerPriceWei = isLimit && triggerPriceStr
                ? parseUnits(triggerPriceStr, 18).toString()
                : undefined;

            if (usdcAddress) {
                setStep('APPROVING');
                await writeContractAsync({
                    chainId,
                    address: usdcAddress,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [TRADING_CORE_ADDRESS, (2n ** 256n) - 1n]
                });
                toast.success("Approved USDC");
            }

            setStep('REVEALING');
            await createOrder({
                market: params.market as Address,
                sizeDelta: sizeDelta6.toString(),
                collateralDelta: collateralDelta18.toString(),
                isLong: params.isLong,
                maxSlippage: String(params.maxSlippageBps ?? 100),
                positionId: 0,
                orderType,
                triggerPriceWei,
            });
            toast.success("Order submitted. A keeper will execute it shortly.");
            return true;
        } catch (err: any) {
            console.error(err);
            toast.error(err.shortMessage || err.message || "Failed to submit order");
            return false;
        } finally {
            setIsLoading(false);
            setStep('IDLE');
        }
    };

    return { executePosition, isLoading, step };
}

export function usePositions() {
    const { address } = useAccount();
    const publicClient = usePublicClient();

    const { data: positionIds, isLoading: loadingIds, refetch } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'getUserPositions',
        args: address ? [address] : undefined,
        query: { enabled: !!address }
    });

    const [positions, setPositions] = useState<PositionData[]>([]);

    const fetchPositions = useCallback(async () => {
        if (positionIds && publicClient && positionIds.length > 0) {
            const proms = (positionIds as bigint[]).map(async (id) => {
                const pos = await publicClient.readContract({
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'getPosition',
                    args: [id]
                });
                const pnlData = await publicClient.readContract({
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'getPositionPnL',
                    args: [id]
                });

                return {
                    id: Number(id),
                    size: Number(pos.size) / 1e18,
                    marketAddress: pos.market,
                    marketId: pos.market,
                    leverage: Number(pos.leverage),
                    entryPrice: Number(pos.entryPrice) / 1e18,
                    liquidationPrice: Number(pos.liquidationPrice) / 1e18,
                    stopLossPrice: Number(pos.stopLossPrice) / 1e18,
                    takeProfitPrice: Number(pos.takeProfitPrice) / 1e18,
                    isLong: (pos.flags & 1) !== 0,
                    pnl: Number(pnlData[0]) / 1e6, // pnl
                    healthFactor: Number(pnlData[1]) / 1e18, // hf
                    isOpen: pos.state === 1,
                    margin: (Number(pos.size) / 1e18 * Number(pos.entryPrice) / 1e18) / Number(pos.leverage)
                };
            });
            const res = await Promise.all(proms);
            setPositions(res.filter(p => p.isOpen));
        } else {
            setPositions([]);
        }
    }, [positionIds, publicClient]);

    useEffect(() => {
        fetchPositions();
    }, [fetchPositions]);

    return { positions, loading: loadingIds, fetchPositions: refetch };
}

export function useAddCollateral() {
    const { chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    return {
        addCollateral: async (id: number, amount: number) => {
            const wei = parseUnits(amount.toFixed(6), 6);
            return writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'addCollateral',
                args: [BigInt(id), wei, BigInt(0), false]
            });
        }
    };
}

export function useClosePosition() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const { playSuccess, playError } = useSound();

    const closePosition = async (id: number) => {
        try {
            const params = {
                positionId: BigInt(id),
                closeSize: BigInt(0),
                minReceive: BigInt(0),
                deadline: BigInt(Math.floor(Date.now() / 1000) + 300)
            };
            await writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'closePosition',
                args: [params] as any
            });
            playSuccess();
            toast.success("Position closed!");
            return true;
        } catch (e: any) {
            playError();
            console.error(e);
            toast.error(e.shortMessage || "Failed close");
            return false;
        }
    };
    return { closePosition, loading: isPending };
}

export function useModifyMargin() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const { address: usdcAddress } = useUSDC();

    const modifyMargin = async (id: any, delta: number) => {
        const amountWei = parseUnits(Math.abs(delta).toFixed(6), 6);
        try {
            if (delta > 0) {
                if (usdcAddress) {
                    await writeContractAsync({
                        chainId,
                        address: usdcAddress,
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [TRADING_CORE_ADDRESS, amountWei]
                    });
                }
                await writeContractAsync({
                    chainId,
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'addCollateral',
                    args: [BigInt(id), amountWei, BigInt(0), false]
                });
                toast.success("Collateral added");
            } else {
                await writeContractAsync({
                    chainId,
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'withdrawCollateral',
                    args: [BigInt(id), amountWei]
                });
                toast.success("Collateral removed");
            }
        } catch (e: any) {
            console.error(e);
            toast.error(e.shortMessage || "Modify failed");
        }
    };
    return { modifyMargin, loading: isPending };
}

/** Set stop loss price for a position. Pass 0 to clear. Price in human units (e.g. 2500.50). */
export function useSetStopLoss() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const setStopLoss = async (positionId: number, price: number) => {
        const priceWei = parseUnits(price.toFixed(18), 18);
        await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'setStopLoss',
            args: [BigInt(positionId), priceWei],
        });
        toast.success(price === 0 ? 'Stop loss cleared' : 'Stop loss set');
    };
    return { setStopLoss, loading: isPending };
}

/** Set take profit price for a position. Pass 0 to clear. Price in human units (e.g. 2500.50). */
export function useSetTakeProfit() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const setTakeProfit = async (positionId: number, price: number) => {
        const priceWei = parseUnits(price.toFixed(18), 18);
        await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'setTakeProfit',
            args: [BigInt(positionId), priceWei],
        });
        toast.success(price === 0 ? 'Take profit cleared' : 'Take profit set');
    };
    return { setTakeProfit, loading: isPending };
}

/** Set trailing stop for a position. bps = basis points (e.g. 100 = 1%). */
export function useSetTrailingStop() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const setTrailingStop = async (positionId: number, bps: number) => {
        await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'setTrailingStop',
            args: [BigInt(positionId), BigInt(bps)],
        });
        toast.success(`Trailing stop set to ${bps / 100}%`);
    };
    return { setTrailingStop, loading: isPending };
}

export function usePartialClose() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const { playSuccess, playError } = useSound();

    const partialClose = async (id: number, percent: number) => {
        try {
            const pctWei = parseUnits((percent / 100).toFixed(18), 18); // 1% = 0.01 = 1e16. 100% = 1.0 = 1e18.
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

            await writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'partialClose',
                args: [BigInt(id), pctWei, BigInt(0), deadline]
            });
            playSuccess();
            toast.success("Partial close submitted");
            return true;
        } catch (e: any) {
            playError();
            console.error(e);
            toast.error(e.shortMessage || "Failed partial close");
            return false;
        }
    };
    return { partialClose, loading: isPending };
}

export function calculatePnL(position: any, currentPrice: number) {
    if (!position) return { pnl: 0, pnlPercent: 0 };
    const diff = position.isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice;
    const pnl = position.size * diff;
    const pnlPercent = position.margin > 0 ? (pnl / position.margin) * 100 : 0;
    return { pnl, pnlPercent };
}

/** Cancel a pending order on-chain. */
export function useCancelOrder() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();

    const cancelOrder = async (orderId: number | bigint) => {
        try {
            await writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'cancelOrder',
                args: [BigInt(orderId)],
            });
            toast.success('Order cancelled');
            return true;
        } catch (e: any) {
            console.error(e);
            toast.error(e.shortMessage || 'Failed to cancel order');
            return false;
        }
    };
    return { cancelOrder, loading: isPending };
}