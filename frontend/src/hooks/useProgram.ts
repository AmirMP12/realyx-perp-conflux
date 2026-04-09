import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSound } from './useSound';
import { type Address, formatUnits, parseUnits } from 'viem';

export const TRADING_CORE_ADDRESS = (import.meta.env.VITE_TRADING_CORE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;
export const VAULT_CORE_ADDRESS = (import.meta.env.VITE_VAULT_CORE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;
export const ORACLE_AGGREGATOR_ADDRESS = (import.meta.env.VITE_ORACLE_AGGREGATOR_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;

export const MOCK_USDC_ADDRESS: Address = (import.meta.env.VITE_MOCK_USDC_ADDRESS ?? '0x4d0874577f1E6326E75EbBAf2F73C548B3ec32F1') as Address;

const ERC20_ABI = [
    { "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "name": "owner", "type": "address" }, { "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;

export const TRADING_CORE_ABI = [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "AccessControlBadConfirmation",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "neededRole",
                "type": "bytes32"
            }
        ],
        "name": "AccessControlUnauthorizedAccount",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            }
        ],
        "name": "AddressEmptyCode",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BatchSizeExceeded",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BreakerActive",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ComplianceCheckFailed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DeadlineExpired",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DeviationOutOfRange",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DuplicateAddress",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "implementation",
                "type": "address"
            }
        ],
        "name": "ERC1967InvalidImplementation",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ERC1967NonPayable",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EnforcedPause",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ExpectedPause",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "FailedCall",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "FlashLoanDetected",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientCollateral",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientOracleSources",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidFeeConfig",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidInitialization",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "MarketClosed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotAdmin",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotGuardian",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotInitializing",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotKeeper",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotLiquidator",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOperator",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOracle",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotPositionOwner",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotPositionToken",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotTradingCore",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "PositionNotFound",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "PositionTooSmall",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ProtocolUnhealthy",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ReentrancyGuardReentrantCall",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "TransferToContractNotAllowed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "UUPSUnauthorizedCallContext",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "slot",
                "type": "bytes32"
            }
        ],
        "name": "UUPSUnsupportedProxiableUUID",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "Unauthorized",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroAddress",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "hub",
                "type": "address"
            }
        ],
        "name": "CircuitBreakerHubUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newCollateral",
                "type": "uint256"
            }
        ],
        "name": "CollateralAdded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newCollateral",
                "type": "uint256"
            }
        ],
        "name": "CollateralWithdrawn",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "makerFeeBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "takerFeeBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "minFeeUsdc",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "lpShareBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "insuranceShareBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "treasuryShareBps",
                        "type": "uint256"
                    }
                ],
                "indexed": false,
                "internalType": "struct DataTypes.FeeConfig",
                "name": "config",
                "type": "tuple"
            }
        ],
        "name": "FeeConfigUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "int256",
                "name": "fundingRate",
                "type": "int256"
            },
            {
                "indexed": false,
                "internalType": "int256",
                "name": "cumulativeFunding",
                "type": "int256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "name": "FundingSettled",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint64",
                "name": "version",
                "type": "uint64"
            }
        ],
        "name": "Initialized",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "maxLeverage",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "maxPositionSize",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "maxTotalExposure",
                "type": "uint256"
            }
        ],
        "name": "MarketUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "orderId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "reason",
                "type": "string"
            }
        ],
        "name": "OrderCancelled",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "orderId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "enum DataTypes.OrderType",
                "name": "orderType",
                "type": "uint8"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "market",
                "type": "address"
            }
        ],
        "name": "OrderCreated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "orderId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "keeper",
                "type": "address"
            }
        ],
        "name": "OrderExecuted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "string",
                "name": "paramName",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "oldValue",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newValue",
                "type": "uint256"
            }
        ],
        "name": "ParamsUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Paused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "trader",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "int256",
                "name": "realizedPnL",
                "type": "int256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "exitPrice",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "closingFee",
                "type": "uint256"
            }
        ],
        "name": "PositionClosed",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "liquidator",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "liquidationPrice",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "liquidationFee",
                "type": "uint256"
            }
        ],
        "name": "PositionLiquidated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newSize",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newLeverage",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newStopLoss",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newTakeProfit",
                "type": "uint256"
            }
        ],
        "name": "PositionModified",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "trader",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "size",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "leverage",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "entryPrice",
                "type": "uint256"
            }
        ],
        "name": "PositionOpened",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "collateral",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "healthFactor",
                "type": "uint256"
            }
        ],
        "name": "PositionUnderwaterAfterFunding",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "previousAdminRole",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "newAdminRole",
                "type": "bytes32"
            }
        ],
        "name": "RoleAdminChanged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "RoleGranted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "RoleRevoked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Unpaused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "implementation",
                "type": "address"
            }
        ],
        "name": "Upgraded",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "ADMIN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "DEFAULT_ADMIN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "GUARDIAN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "KEEPER_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "LIQUIDATOR_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "MAX_ACTIVE_MARKETS",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "OPERATOR_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ORACLE_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "TRADING_CORE_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "UPGRADE_INTERFACE_VERSION",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "index",
                "type": "uint256"
            }
        ],
        "name": "activeMarketAt",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "activeMarketCount",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "amt",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxLev",
                "type": "uint256"
            },
            {
                "internalType": "bool",
                "name": "emg",
                "type": "bool"
            }
        ],
        "name": "addCollateral",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address[]",
                "name": "accounts",
                "type": "address[]"
            }
        ],
        "name": "batchGrantRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address[]",
                "name": "accounts",
                "type": "address[]"
            }
        ],
        "name": "batchRevokeRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "canLiquidate",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            },
            {
                "internalType": "uint256",
                "name": "hf",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "orderId",
                "type": "uint256"
            }
        ],
        "name": "cancelOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "circuitBreakerHub",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "u",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "maxClean",
                "type": "uint256"
            }
        ],
        "name": "cleanupPositions",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "positionId",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "closeSize",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "minReceive",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "deadline",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct DataTypes.ClosePositionParams",
                "name": "p",
                "type": "tuple"
            }
        ],
        "name": "closePosition",
        "outputs": [
            {
                "internalType": "int256",
                "name": "",
                "type": "int256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "complianceManager",
        "outputs": [
            {
                "internalType": "contract IComplianceManager",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "enum DataTypes.OrderType",
                "name": "orderType",
                "type": "uint8"
            },
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "sizeDelta",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "collateralDelta",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "triggerPrice",
                "type": "uint256"
            },
            {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
            },
            {
                "internalType": "uint256",
                "name": "maxSlippage",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "createOrder",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "orderId",
                "type": "uint256"
            }
        ],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "dividendManager",
        "outputs": [
            {
                "internalType": "contract IDividendManager",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "dustAccumulator",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "totalDust",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "lastSweepTimestamp",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "sweepThreshold",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "orderId",
                "type": "uint256"
            },
            {
                "internalType": "bytes[]",
                "name": "",
                "type": "bytes[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256[]",
                "name": "positionIds",
                "type": "uint256[]"
            }
        ],
        "name": "executeStopLossTakeProfit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "failedRepaymentCount",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "index",
                "type": "uint256"
            }
        ],
        "name": "failedRepaymentIdAt",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "feeConfig",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "makerFeeBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "takerFeeBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "minFeeUsdc",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "lpShareBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "insuranceShareBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "treasuryShareBps",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "addr",
                "type": "address"
            }
        ],
        "name": "getBalances",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "keeperFee",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "orderRefund",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "orderCollateralRefund",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "getFailedRepayment",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "amount",
                        "type": "uint256"
                    },
                    {
                        "internalType": "address",
                        "name": "market",
                        "type": "address"
                    },
                    {
                        "internalType": "bool",
                        "name": "isLong",
                        "type": "bool"
                    },
                    {
                        "internalType": "int256",
                        "name": "pnl",
                        "type": "int256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "timestamp",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bool",
                        "name": "resolved",
                        "type": "bool"
                    }
                ],
                "internalType": "struct DataTypes.FailedRepayment",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "c",
                "type": "address"
            }
        ],
        "name": "getFundingState",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "int256",
                        "name": "fundingRate",
                        "type": "int256"
                    },
                    {
                        "internalType": "int256",
                        "name": "cumulativeFunding",
                        "type": "int256"
                    },
                    {
                        "internalType": "uint64",
                        "name": "lastSettlement",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint256",
                        "name": "longOpenInterest",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "shortOpenInterest",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct DataTypes.FundingState",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getGlobalUnrealizedPnL",
        "outputs": [
            {
                "internalType": "int256",
                "name": "totalPnL",
                "type": "int256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "c",
                "type": "address"
            }
        ],
        "name": "getMarketInfo",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "chainlinkFeed",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maxStaleness",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maxPriceUncertainty",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint128",
                        "name": "maxPositionSize",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint128",
                        "name": "maxTotalExposure",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint16",
                        "name": "maintenanceMargin",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "initialMargin",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint64",
                        "name": "maxLeverage",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalLongSize",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalShortSize",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalLongCost",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalShortCost",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bool",
                        "name": "isActive",
                        "type": "bool"
                    },
                    {
                        "internalType": "bool",
                        "name": "isListed",
                        "type": "bool"
                    }
                ],
                "internalType": "struct DataTypes.Market",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "getPosition",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "uint128",
                        "name": "size",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint128",
                        "name": "entryPrice",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint128",
                        "name": "liquidationPrice",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint128",
                        "name": "stopLossPrice",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint128",
                        "name": "takeProfitPrice",
                        "type": "uint128"
                    },
                    {
                        "internalType": "uint64",
                        "name": "leverage",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "lastFundingTime",
                        "type": "uint64"
                    },
                    {
                        "internalType": "address",
                        "name": "market",
                        "type": "address"
                    },
                    {
                        "internalType": "uint40",
                        "name": "openTimestamp",
                        "type": "uint40"
                    },
                    {
                        "internalType": "uint16",
                        "name": "trailingStopBps",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint8",
                        "name": "flags",
                        "type": "uint8"
                    },
                    {
                        "internalType": "enum DataTypes.CollateralType",
                        "name": "collateralType",
                        "type": "uint8"
                    },
                    {
                        "internalType": "enum DataTypes.PosStatus",
                        "name": "state",
                        "type": "uint8"
                    }
                ],
                "internalType": "struct DataTypes.Position",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "getPositionCollateral",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "tokenAddress",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "getPositionPnL",
        "outputs": [
            {
                "internalType": "int256",
                "name": "pnl",
                "type": "int256"
            },
            {
                "internalType": "uint256",
                "name": "hf",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getProtocolHealthState",
        "outputs": [
            {
                "internalType": "bool",
                "name": "isHealthy",
                "type": "bool"
            },
            {
                "internalType": "uint256",
                "name": "totalBadDebt",
                "type": "uint256"
            },
            {
                "internalType": "uint64",
                "name": "lastHealthCheck",
                "type": "uint64"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            }
        ],
        "name": "getRoleAdmin",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "u",
                "type": "address"
            }
        ],
        "name": "getUserPositions",
        "outputs": [
            {
                "internalType": "uint256[]",
                "name": "",
                "type": "uint256[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "globalDailyVolumeLimit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "grantRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "hasAnyRole",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "hasRole",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "admin",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_usdc",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_treasury",
                "type": "address"
            }
        ],
        "name": "initialize",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "largeActionInterval",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "largeActionThreshold",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "liquidatePosition",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "reward",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "liquidationDeviationBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "liquidationTiers",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "nearThresholdBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mediumRiskBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "deeplyUnderwaterBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "liquidatorShareBps",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "marketCalendar",
        "outputs": [
            {
                "internalType": "contract IMarketCalendar",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "marketIds",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxActionsPerBlock",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxOracleUncertainty",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxPositionsPerUser",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxUserExposure",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minExecutionFee",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minInteractionDelay",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minPositionDuration",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minPositionSize",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "nextPositionId",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "oracleAggregator",
        "outputs": [
            {
                "internalType": "contract IOracleAggregator",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "pct",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "minRcv",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "dl",
                "type": "uint256"
            }
        ],
        "name": "partialClose",
        "outputs": [
            {
                "internalType": "int256",
                "name": "",
                "type": "int256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "name": "positionDividendIndex",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "positionToken",
        "outputs": [
            {
                "internalType": "contract IPositionToken",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "protocolHealth",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "totalBadDebt",
                "type": "uint256"
            },
            {
                "internalType": "uint64",
                "name": "lastHealthCheck",
                "type": "uint64"
            },
            {
                "internalType": "bool",
                "name": "isHealthy",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "proxiableUUID",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
            },
            {
                "internalType": "int256",
                "name": "pnl",
                "type": "int256"
            }
        ],
        "name": "recordFailedRepayment",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "callerConfirmation",
                "type": "address"
            }
        ],
        "name": "renounceRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "resolveFailedRepayment",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "revokeRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_hub",
                "type": "address"
            }
        ],
        "name": "setCircuitBreakerHub",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_vc",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_oa",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_pt",
                "type": "address"
            }
        ],
        "name": "setContracts",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "makerFeeBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "takerFeeBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "minFeeUsdc",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "lpShareBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "insuranceShareBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "treasuryShareBps",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct DataTypes.FeeConfig",
                "name": "_config",
                "type": "tuple"
            }
        ],
        "name": "setFeeConfig",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "_uvl",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_gvl",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_lat",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_lai",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_mue",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_mpd",
                "type": "uint256"
            }
        ],
        "name": "setLimits",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "m",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "feed",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "maxLev",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxPos",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxExp",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mmBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "imBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxStaleness",
                "type": "uint256"
            }
        ],
        "name": "setMarket",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "string",
                "name": "marketId",
                "type": "string"
            }
        ],
        "name": "setMarketId",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "mps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mou",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mab",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mef",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mpp",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mid",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "ldb",
                "type": "uint256"
            }
        ],
        "name": "setParams",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_calendar",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_dividendManager",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_complianceManager",
                "type": "address"
            }
        ],
        "name": "setRWAContracts",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "sl",
                "type": "uint256"
            }
        ],
        "name": "setStopLoss",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "tp",
                "type": "uint256"
            }
        ],
        "name": "setTakeProfit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_v",
                "type": "address"
            }
        ],
        "name": "setTradingViews",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "bps",
                "type": "uint256"
            }
        ],
        "name": "setTrailingStop",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "forwarder",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "trusted",
                "type": "bool"
            }
        ],
        "name": "setTrustedForwarder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            }
        ],
        "name": "settleFunding",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "settlePositionFunding",
        "outputs": [
            {
                "internalType": "int256",
                "name": "paid",
                "type": "int256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes4",
                "name": "interfaceId",
                "type": "bytes4"
            }
        ],
        "name": "supportsInterface",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "sweepDust",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalFailedRepayments",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "tradingViews",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "treasury",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "trustedForwarders",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "m",
                "type": "address"
            }
        ],
        "name": "unlistMarket",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "unpause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "m",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "feed",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "maxLev",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxPos",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxExp",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "mmBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "imBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxStaleness",
                "type": "uint256"
            }
        ],
        "name": "updateMarket",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "oldOwner",
                "type": "address"
            }
        ],
        "name": "updatePositionOwner",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "updateProtocolHealth",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newImplementation",
                "type": "address"
            },
            {
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
            }
        ],
        "name": "upgradeToAndCall",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "usdc",
        "outputs": [
            {
                "internalType": "contract IERC20",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "userDailyVolumeLimit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            }
        ],
        "name": "validateOracleForMarket",
        "outputs": [],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "vaultCore",
        "outputs": [
            {
                "internalType": "contract IVaultCore",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "amt",
                "type": "uint256"
            }
        ],
        "name": "withdrawCollateral",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "withdrawKeeperFees",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "withdrawOrderCollateralRefund",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "withdrawOrderRefund",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

export const ORACLE_ABI = [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "AccessControlBadConfirmation",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "neededRole",
                "type": "bytes32"
            }
        ],
        "name": "AccessControlUnauthorizedAccount",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "AdapterNotFound",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            }
        ],
        "name": "AddressEmptyCode",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "AlreadyConfirmed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "AlreadyInitialized",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BatchSizeExceeded",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BreakerAlreadyTriggered",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BreakerNotConfigured",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BreakerNotTriggered",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "CooldownActive",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DataNotFound",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DeviationTooHigh",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DuplicateAddress",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "implementation",
                "type": "address"
            }
        ],
        "name": "ERC1967InvalidImplementation",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ERC1967NonPayable",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EmergencyPriceAlreadyConfirmed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EmergencyPriceDeviationTooHigh",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EmergencyPriceProposalExpired",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EmergencyPriceProposalNotFound",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EnforcedPause",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ExpectedPause",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "FailedCall",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "GlobalPauseActive",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientConfidence",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientConfirmations",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientTWAPData",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidCooldownSeconds",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidInitialization",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidSource",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidWindowSeconds",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NoEthUsdFeed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NoValidPrice",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotAdmin",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotGuardian",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotInitializing",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotKeeper",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotLiquidator",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOperator",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOracle",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOracleOrKeeper",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotRegistered",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotTradingCore",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "PriceOutOfBounds",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ProposalExpired",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ProposalNotFound",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ReentrancyGuardReentrantCall",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "SequencerDown",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "SequencerGracePeriodNotOver",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "StalePrice",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "TWAPOverflow",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "TWAPUpdateTooFrequent",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "TimelockNotExpired",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "UUPSUnauthorizedCallContext",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "slot",
                "type": "bytes32"
            }
        ],
        "name": "UUPSUnsupportedProxiableUUID",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroAddress",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            },
            {
                "indexed": false,
                "internalType": "bool",
                "name": "enabled",
                "type": "bool"
            }
        ],
        "name": "BreakerEnabledUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "resetBy",
                "type": "address"
            }
        ],
        "name": "BreakerReset",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "threshold",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "actualValue",
                "type": "uint256"
            }
        ],
        "name": "BreakerTriggered",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "threshold",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "currentValue",
                "type": "uint256"
            }
        ],
        "name": "CircuitBreakerAlert",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "hub",
                "type": "address"
            }
        ],
        "name": "CircuitBreakerHubUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "pauseId",
                "type": "bytes32"
            },
            {
                "indexed": false,
                "internalType": "address[]",
                "name": "targets",
                "type": "address[]"
            }
        ],
        "name": "EmergencyPauseExecuted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "pauseId",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "proposer",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "address[]",
                "name": "targets",
                "type": "address[]"
            }
        ],
        "name": "EmergencyPauseProposed",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "proposalId",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "price",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "proposer",
                "type": "address"
            }
        ],
        "name": "EmergencyPriceProposed",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "activator",
                "type": "address"
            }
        ],
        "name": "GlobalPauseActivated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "deactivator",
                "type": "address"
            }
        ],
        "name": "GlobalPauseDeactivated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint64",
                "name": "version",
                "type": "uint64"
            }
        ],
        "name": "Initialized",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Paused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "pythPrice",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "aggregatedPrice",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "deviationBps",
                "type": "uint256"
            }
        ],
        "name": "PriceDeviation",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "price",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "confidence",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "name": "PriceUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "feedId",
                "type": "bytes32"
            }
        ],
        "name": "PythFeedSet",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "previousAdminRole",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "newAdminRole",
                "type": "bytes32"
            }
        ],
        "name": "RoleAdminChanged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "RoleGranted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "RoleRevoked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "twapPrice",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "windowSeconds",
                "type": "uint256"
            }
        ],
        "name": "TWAPUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Unpaused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "implementation",
                "type": "address"
            }
        ],
        "name": "Upgraded",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "ADMIN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "DEFAULT_ADMIN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "GUARDIAN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "KEEPER_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "LIQUIDATOR_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "OPERATOR_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ORACLE_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "PRICE_OVERRIDE_DELAY",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "TRADING_CORE_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "UPGRADE_INTERFACE_VERSION",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "activateGlobalPause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "addSupportedMarket",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "autoResetBreakers",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address[]",
                "name": "accounts",
                "type": "address[]"
            }
        ],
        "name": "batchGrantRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address[]",
                "name": "accounts",
                "type": "address[]"
            }
        ],
        "name": "batchRevokeRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "currentPrice",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "name": "checkBreakers",
        "outputs": [
            {
                "internalType": "bool",
                "name": "triggered",
                "type": "bool"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "circuitBreakerHub",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            },
            {
                "internalType": "uint256",
                "name": "threshold",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "windowSeconds",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "cooldownSeconds",
                "type": "uint256"
            }
        ],
        "name": "configureBreaker",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "pauseId",
                "type": "bytes32"
            }
        ],
        "name": "confirmEmergencyPause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "proposalId",
                "type": "bytes32"
            }
        ],
        "name": "confirmEmergencyPrice",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "deactivateGlobalPause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "defaultMaxDeviationBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "defaultMaxStaleness",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "emergencyPriceQuorum",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ethFeedId",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "failedPauseCount",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "failedPauses",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            }
        ],
        "name": "getBreakerConfig",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "enum DataTypes.BreakerType",
                        "name": "breakerType",
                        "type": "uint8"
                    },
                    {
                        "internalType": "uint256",
                        "name": "threshold",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "windowSeconds",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "cooldownSeconds",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bool",
                        "name": "enabled",
                        "type": "bool"
                    }
                ],
                "internalType": "struct DataTypes.BreakerConfig",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            }
        ],
        "name": "getBreakerStatus",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "enum DataTypes.BreakerState",
                        "name": "state",
                        "type": "uint8"
                    },
                    {
                        "internalType": "uint256",
                        "name": "triggeredAt",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "resetAt",
                        "type": "uint256"
                    },
                    {
                        "internalType": "address",
                        "name": "triggeredBy",
                        "type": "address"
                    }
                ],
                "internalType": "struct DataTypes.BreakerStatus",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getEthUsdPrice",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "price",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getGuardianQuorum",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "hoursAgo",
                "type": "uint256"
            }
        ],
        "name": "getHistoricalPrice",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "getOracleConfig",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            },
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getPausableList",
        "outputs": [
            {
                "internalType": "address[]",
                "name": "",
                "type": "address[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "getPrice",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "price",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "confidence",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "maxUncertainty",
                "type": "uint256"
            }
        ],
        "name": "getPriceWithConfidence",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "price",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            }
        ],
        "name": "getRoleAdmin",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getSupportedMarkets",
        "outputs": [
            {
                "internalType": "address[]",
                "name": "",
                "type": "address[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "windowSeconds",
                "type": "uint256"
            }
        ],
        "name": "getTWAP",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "twapPrice",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "windowSeconds",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "minDataPoints",
                "type": "uint256"
            }
        ],
        "name": "getTWAPWithValidation",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "twapPrice",
                "type": "uint256"
            },
            {
                "internalType": "bool",
                "name": "isValid",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "getValidSourceCount",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "grantRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "guardianQuorum",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "hasAnyRole",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "hasRole",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "admin",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_pyth",
                "type": "address"
            }
        ],
        "name": "initialize",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint8",
                "name": "actionType",
                "type": "uint8"
            }
        ],
        "name": "isActionAllowed",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "isGloballyPaused",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "isMarketRestricted",
        "outputs": [
            {
                "internalType": "bool",
                "name": "isRestricted",
                "type": "bool"
            },
            {
                "internalType": "uint256",
                "name": "activeBreakers",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            }
        ],
        "name": "isOracleHealthy",
        "outputs": [
            {
                "internalType": "bool",
                "name": "healthy",
                "type": "bool"
            },
            {
                "internalType": "string",
                "name": "reason",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "marketCalendar",
        "outputs": [
            {
                "internalType": "contract IMarketCalendar",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "marketIds",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxEthStaleness",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address[]",
                "name": "targets",
                "type": "address[]"
            },
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "name": "proposeEmergencyPause",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "pauseId",
                "type": "bytes32"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "price",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "validUntil",
                "type": "uint256"
            }
        ],
        "name": "proposeEmergencyPrice",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "proposalId",
                "type": "bytes32"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "proxiableUUID",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pyth",
        "outputs": [
            {
                "internalType": "contract IPyth",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "name": "recordPricePoint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            }
        ],
        "name": "registerPausable",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "callerConfirmation",
                "type": "address"
            }
        ],
        "name": "renounceRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            }
        ],
        "name": "resetBreaker",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "revokeRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "sequencerCheckEnabled",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "sequencerGracePeriod",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "sequencerUptimeFeed",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            },
            {
                "internalType": "bool",
                "name": "enabled",
                "type": "bool"
            }
        ],
        "name": "setBreakerEnabled",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_hub",
                "type": "address"
            }
        ],
        "name": "setCircuitBreakerHub",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "quorum",
                "type": "uint256"
            }
        ],
        "name": "setEmergencyPriceQuorum",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "_feedId",
                "type": "bytes32"
            }
        ],
        "name": "setEthFeedId",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "quorum",
                "type": "uint256"
            }
        ],
        "name": "setGuardianQuorum",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_calendar",
                "type": "address"
            }
        ],
        "name": "setMarketCalendar",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "string",
                "name": "marketId",
                "type": "string"
            }
        ],
        "name": "setMarketId",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "feedId",
                "type": "bytes32"
            },
            {
                "internalType": "uint256",
                "name": "maxStaleness",
                "type": "uint256"
            },
            {
                "internalType": "uint64",
                "name": "maxConfidence",
                "type": "uint64"
            }
        ],
        "name": "setPythFeed",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes4",
                "name": "interfaceId",
                "type": "bytes4"
            }
        ],
        "name": "supportsInterface",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "collection",
                "type": "address"
            },
            {
                "internalType": "enum DataTypes.BreakerType",
                "name": "breakerType",
                "type": "uint8"
            }
        ],
        "name": "triggerBreaker",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "unpause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newImplementation",
                "type": "address"
            },
            {
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
            }
        ],
        "name": "upgradeToAndCall",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    }
] as const;

export const VAULT_ABI = [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "AccessControlBadConfirmation",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "neededRole",
                "type": "bytes32"
            }
        ],
        "name": "AccessControlUnauthorizedAccount",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            }
        ],
        "name": "AddressEmptyCode",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "BatchSizeExceeded",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ClaimInvalidOrPaid",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ClaimNotApproved",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ClaimRateLimitExceeded",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "CollectionExposureLimitExceeded",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "CooldownNotComplete",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "CooldownNotStarted",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DuplicateAddress",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "implementation",
                "type": "address"
            }
        ],
        "name": "ERC1967InvalidImplementation",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ERC1967NonPayable",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EmergencyModeActive",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EnforcedPause",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "EscapeTimelockNotExpired",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ExceedsExposureCap",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ExpectedPause",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "FailedCall",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientLiquidity",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientRepayBalance",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientShares",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsuranceFundCircuitBreakerActive",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidFirstDeposit",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidInitialization",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidRequest",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidTVL",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "MinimumDepositRequired",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotAdmin",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotEmergencyMode",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotGuardian",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotInitializing",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotKeeper",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotLiquidator",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOperator",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOracle",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotOwner",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotTradingCore",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ReentrancyGuardReentrantCall",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            }
        ],
        "name": "SafeERC20FailedOperation",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "UUPSUnauthorizedCallContext",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "slot",
                "type": "bytes32"
            }
        ],
        "name": "UUPSUnsupportedProxiableUUID",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "UnhealthyRatio",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "UtilizationTooHigh",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "WithdrawalNotReady",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroAddress",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroAssets",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroShares",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "BadDebtCovered",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "hub",
                "type": "address"
            }
        ],
        "name": "CircuitBreakerHubUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "paid",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "remaining",
                "type": "uint256"
            }
        ],
        "name": "ClaimPartialPayment",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "ClaimSubmitted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "Deposit",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "requestedAssets",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "actualAssets",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "EmergencyEscapeWithdrawCapped",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "name": "EmergencyModeActivated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "name": "EmergencyModeDeactivated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "oldCap",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newCap",
                "type": "uint256"
            }
        ],
        "name": "ExposureCapUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "longExposure",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shortExposure",
                "type": "uint256"
            }
        ],
        "name": "ExposureUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "feeType",
                "type": "string"
            }
        ],
        "name": "FeeReceived",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint64",
                "name": "version",
                "type": "uint64"
            }
        ],
        "name": "Initialized",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "resetter",
                "type": "address"
            }
        ],
        "name": "InsuranceCircuitBreakerReset",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "threshold",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "cumulative",
                "type": "uint256"
            }
        ],
        "name": "InsuranceCircuitBreakerTriggered",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "InsuranceStaked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "InsuranceUnstaked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Paused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "int256",
                "name": "pnl",
                "type": "int256"
            },
            {
                "indexed": false,
                "internalType": "bool",
                "name": "isProfit",
                "type": "bool"
            }
        ],
        "name": "PnLSettled",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "oldTVL",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "newTVL",
                "type": "uint256"
            }
        ],
        "name": "ProtocolTVLUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "previousAdminRole",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "newAdminRole",
                "type": "bytes32"
            }
        ],
        "name": "RoleAdminChanged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "RoleGranted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "RoleRevoked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "total",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "stakerShare",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "treasuryShare",
                "type": "uint256"
            }
        ],
        "name": "SurplusDistributed",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "restrictionBps",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "emergencyBps",
                "type": "uint256"
            }
        ],
        "name": "ThresholdsUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "oldTreasury",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "newTreasury",
                "type": "address"
            }
        ],
        "name": "TreasuryUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Unpaused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "name": "UnstakeRequested",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "implementation",
                "type": "address"
            }
        ],
        "name": "Upgraded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "utilization",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "bool",
                "name": "isEmergency",
                "type": "bool"
            }
        ],
        "name": "UtilizationAlert",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "Withdraw",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "requestId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "reason",
                "type": "string"
            }
        ],
        "name": "WithdrawalCancelled",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "requestId",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            }
        ],
        "name": "WithdrawalProcessed",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "requestId",
                "type": "uint256"
            }
        ],
        "name": "WithdrawalQueued",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "ADMIN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "BAD_DEBT_CIRCUIT_BREAKER_BPS",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "CLAIM_WINDOW_DURATION",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "DEFAULT_ADMIN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "GUARDIAN_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "KEEPER_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "LIQUIDATOR_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "MAX_EMERGENCY_DURATION",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "OPERATOR_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ORACLE_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "TRADING_CORE_ROLE",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "UPGRADE_INTERFACE_VERSION",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "accumulatedFees",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "approvalThreshold",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            }
        ],
        "name": "approveClaim",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "asset",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address[]",
                "name": "accounts",
                "type": "address[]"
            }
        ],
        "name": "batchGrantRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address[]",
                "name": "accounts",
                "type": "address[]"
            }
        ],
        "name": "batchRevokeRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
            }
        ],
        "name": "borrow",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "circuitBreakerHub",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "convertToAssets",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            }
        ],
        "name": "convertToShares",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "coverBadDebt",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "covered",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "cumulativeBadDebt24h",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "defaultMarketBadDebtLimit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "defaultMaxExposureBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
            }
        ],
        "name": "deposit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "distributeSurplus",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "emergencyEscapeWithdraw",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "emergencyModeActivatedAt",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "emergencyThresholdBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getAvailableLiquidity",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            }
        ],
        "name": "getClaim",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "amount",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "positionId",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "timestamp",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bool",
                        "name": "approved",
                        "type": "bool"
                    },
                    {
                        "internalType": "bool",
                        "name": "paid",
                        "type": "bool"
                    },
                    {
                        "internalType": "uint256",
                        "name": "amountPaid",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct DataTypes.BadDebtClaim",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getConservativeTotalAssets",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getConservativeUtilization",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getInsuranceHealthRatio",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getLPSharePrice",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            }
        ],
        "name": "getMarketExposure",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "longExposure",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "shortExposure",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maxExposurePercent",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct DataTypes.MarketExposure",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            }
        ],
        "name": "getRoleAdmin",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getUtilization",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "requestId",
                "type": "uint256"
            }
        ],
        "name": "getWithdrawalRequest",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "shares",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "requestTime",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "minAssets",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bool",
                        "name": "processed",
                        "type": "bool"
                    }
                ],
                "internalType": "struct DataTypes.WithdrawalRequest",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "grantRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "hasAnyRole",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "hasRole",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "admin",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_usdc",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_treasury",
                "type": "address"
            }
        ],
        "name": "initialize",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "user",
                "type": "address"
            }
        ],
        "name": "insBalanceOf",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "insTotalShares",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "insuranceAssets",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "insuranceCircuitBreakerActive",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "isEmergencyMode",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "isInsuranceHealthy",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "lastBadDebtResetTime",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "lpAssets",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "user",
                "type": "address"
            }
        ],
        "name": "lpBalanceOf",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "lpTotalShares",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "marketBadDebtLimit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxClaimsPerWindow",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "maxDeposit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "pure",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "maxProtocolTVL",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            }
        ],
        "name": "maxRedeem",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minInitialDeposit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minRatioBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pendingPnL",
        "outputs": [
            {
                "internalType": "int256",
                "name": "",
                "type": "int256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            }
        ],
        "name": "previewDeposit",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "name": "previewWithdraw",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            }
        ],
        "name": "processClaim",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256[]",
                "name": "requestIds",
                "type": "uint256[]"
            }
        ],
        "name": "processWithdrawals",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "processed",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "protocolTVL",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "proxiableUUID",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "minAssets",
                "type": "uint256"
            }
        ],
        "name": "queueWithdrawal",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "requestId",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "rateLimitCurrentLevel",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "rateLimitLastUpdate",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "receiveFees",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "callerConfirmation",
                "type": "address"
            }
        ],
        "name": "renounceRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
            },
            {
                "internalType": "int256",
                "name": "pnl",
                "type": "int256"
            }
        ],
        "name": "repay",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "requestUnstake",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "reservedLiquidity",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "resetInsuranceCircuitBreaker",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "restrictionThresholdBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "role",
                "type": "bytes32"
            },
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "revokeRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_hub",
                "type": "address"
            }
        ],
        "name": "setCircuitBreakerHub",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "maxBps",
                "type": "uint256"
            }
        ],
        "name": "setMaxExposure",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "_maxTVL",
                "type": "uint256"
            }
        ],
        "name": "setMaxProtocolTVL",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "_restrictionBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_emergencyBps",
                "type": "uint256"
            }
        ],
        "name": "setThresholds",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_tradingCore",
                "type": "address"
            }
        ],
        "name": "setTradingCore",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_treasury",
                "type": "address"
            }
        ],
        "name": "setTreasury",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
            }
        ],
        "name": "stakeInsurance",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "stopEmergencyMode",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "positionId",
                "type": "uint256"
            }
        ],
        "name": "submitClaim",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "claimId",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes4",
                "name": "interfaceId",
                "type": "bytes4"
            }
        ],
        "name": "supportsInterface",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "targetRatioBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalAssets",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalBorrowed",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalPendingClaims",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "tradingCore",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "treasury",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "treasurySurplusShareBps",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "triggerEmergencyMode",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "unpause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "unstakeCooldown",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
            }
        ],
        "name": "unstakeInsurance",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "market",
                "type": "address"
            },
            {
                "internalType": "int256",
                "name": "sizeDelta",
                "type": "int256"
            },
            {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
            }
        ],
        "name": "updateExposure",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "_tvl",
                "type": "uint256"
            }
        ],
        "name": "updateProtocolTVL",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newImplementation",
                "type": "address"
            },
            {
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
            }
        ],
        "name": "upgradeToAndCall",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "usdc",
        "outputs": [
            {
                "internalType": "contract IERC20",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "shares",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            }
        ],
        "name": "withdraw",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "assets",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "withdrawalCooldown",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
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

/** Check current allowance for TradingCore. */
export function useAllowance() {
    const { address: userAddress } = useAccount();
    const { address: usdcAddress } = useUSDC();
    const { data: allowance, refetch, isLoading } = useReadContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: userAddress ? [userAddress, TRADING_CORE_ADDRESS] : undefined,
        query: { enabled: !!usdcAddress && !!userAddress },
    });
    return { allowance: allowance as bigint | undefined, refetch, loading: isLoading };
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
    const publicClient = usePublicClient();
    const { allowance, refetch: refetchAllowance } = useAllowance();

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
            if (!publicClient) throw new Error("Public client not available");

            const orderType = params.orderType ?? OrderType.MARKET_INCREASE;
            const isLimit = orderType === OrderType.LIMIT_INCREASE || orderType === OrderType.LIMIT_DECREASE;
            const triggerPriceStr = params.triggerPrice?.trim();
            if (isLimit && (!triggerPriceStr || parseFloat(triggerPriceStr) <= 0)) {
                throw new Error('Limit and stop orders require a trigger price');
            }

            // 1. Check if market is listed
            const marketInfo = await publicClient.readContract({
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'getMarketInfo',
                args: [params.market as Address]
            }) as any;

            if (!marketInfo || !marketInfo.isListed) {
                throw new Error(`Market ${params.market} is not registered in the protocol.`);
            }

            const sizeNum = parseFloat(params.size);
            const leverageNum = parseFloat(params.leverage);

            // sizeDelta is in USDC – it IS the notional value, not an asset quantity.
            const notionalValue = sizeNum;

            // The smart contract assesses an opening fee (0.05% taker + min $0.10).
            const baseMargin = leverageNum > 0 ? notionalValue / leverageNum : sizeNum;
            const estimatedOpeningFee = Math.max(0.10, notionalValue * 0.0005);
            const marginUSDC = baseMargin + estimatedOpeningFee;

            const sizeDelta6 = parseUnits(sizeNum.toFixed(6), 6);
            const collateralDelta6 = parseUnits(marginUSDC.toFixed(6), 6); // USDC precision
            const triggerPriceWei = isLimit && triggerPriceStr
                ? parseUnits(triggerPriceStr, 18).toString()
                : undefined;

            // 2. Allowance check
            if (usdcAddress) {
                const requiredCollateral = collateralDelta6; // Already in USDC precision (6)
                
                // Fetch fresh allowance if not available or insufficient
                let currentAllowance = allowance;
                if (currentAllowance === undefined) {
                    const { data } = await refetchAllowance();
                    currentAllowance = data as bigint | undefined;
                }

                if (!currentAllowance || currentAllowance < requiredCollateral) {
                    setStep('APPROVING');
                    const hash = await writeContractAsync({
                        chainId,
                        address: usdcAddress,
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [TRADING_CORE_ADDRESS, (2n ** 256n) - 1n]
                    });
                    
                    toast.loading("Waiting for approval confirmation...");
                    await publicClient.waitForTransactionReceipt({ hash });
                    toast.success("USDC approved successfully");
                    await refetchAllowance();
                }
            }

            setStep('REVEALING');
            await createOrder({
                market: params.market as Address,
                sizeDelta: sizeDelta6.toString(),
                collateralDelta: collateralDelta6.toString(),
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
    const { chainId, address } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const { address: usdcAddress } = useUSDC();
    const publicClient = usePublicClient();
    const { allowance, refetch: refetchAllowance } = useAllowance();
    const [isPending, setIsPending] = useState(false);

    const modifyMargin = async (id: any, delta: number) => {
        setIsPending(true);
        const amountWei = parseUnits(Math.abs(delta).toFixed(6), 6);
        try {
            if (!address) throw new Error("Wallet not connected");
            if (!publicClient) throw new Error("Public client not available");

            if (delta > 0) {
                // ADDING COLLATERAL
                if (usdcAddress) {
                    // Check allowance
                    let currentAllowance = allowance;
                    if (currentAllowance === undefined) {
                        const { data } = await refetchAllowance();
                        currentAllowance = data as bigint | undefined;
                    }

                    if (!currentAllowance || currentAllowance < amountWei) {
                        const hash = await writeContractAsync({
                            chainId,
                            address: usdcAddress,
                            abi: ERC20_ABI,
                            functionName: 'approve',
                            args: [TRADING_CORE_ADDRESS, amountWei]
                        });
                        toast.loading("Waiting for approval confirmation...");
                        await publicClient.waitForTransactionReceipt({ hash });
                        toast.success("USDC approved");
                        await refetchAllowance();
                    }
                }
                
                await writeContractAsync({
                    chainId,
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'addCollateral',
                    args: [BigInt(id), amountWei, BigInt(0), false]
                });
                toast.success("Collateral added. It will reflect shortly.");
            } else {
                // REMOVING COLLATERAL
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
            toast.error(e.shortMessage || e.message || "Modify failed");
        } finally {
            setIsPending(false);
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