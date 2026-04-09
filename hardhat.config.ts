import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const deployRpcTimeoutMs = Number(process.env.DEPLOY_RPC_TIMEOUT_MS || "900000");

// Helper to get accounts from env
const getAccounts = () => {
    const privateKey = process.env.PRIVATE_KEY;
    const mnemonic = process.env.MNEMONIC;

    if (privateKey) return [privateKey];
    if (mnemonic) return { mnemonic };
    return [];
};

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.24",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1,
                    },
                    viaIR: true,
                    evmVersion: "paris",
                    debug: {
                        revertStrings: "strip",
                    },
                },
            },
            {
                version: "0.8.20",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 50,
                    },
                    viaIR: true,
                },
            },
        ],
    },

    // Path configuration
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },

    // TypeChain configuration for type-safe contract interactions
    typechain: {
        outDir: "typechain",
        target: "ethers-v6",
    },

    // Mocha test configuration
    mocha: {
        timeout: 300000,  // 5 minutes for complex/fuzz tests
    },

    networks: {
        // Local Development
        hardhat: {
            chainId: 31337,
            allowUnlimitedContractSize: true,
            hardfork: "shanghai",
            initialBaseFeePerGas: 0,
            gas: 30000000,
            blockGasLimit: 30000000,
            mining: {
                auto: true,
                interval: 0,
            },
        },
        coverage: {
            url: "http://127.0.0.1:8555",
            gasPrice: 1000000000,
            initialBaseFeePerGas: 0,
            gas: 0x1fffffffffffff,
            blockGasLimit: 0x1fffffffffffff
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            chainId: 31337,
        },

        // Conflux eSpace
        conflux: {
            url: process.env.CONFLUX_RPC_URL || "https://evm.confluxrpc.com",
            accounts: getAccounts() as string[],
            chainId: 1030,
            timeout: deployRpcTimeoutMs,
            gasPrice: process.env.GAS_PRICE_GWEI ? parseInt(process.env.GAS_PRICE_GWEI, 10) * 1e9 : undefined,
        },
        confluxTestnet: {
            url: process.env.CONFLUX_TESTNET_RPC_URL || "https://evmtest.confluxrpc.com",
            accounts: getAccounts() as string[],
            chainId: 71,
            timeout: deployRpcTimeoutMs,
            gasPrice: process.env.GAS_PRICE_GWEI ? parseInt(process.env.GAS_PRICE_GWEI, 10) * 1e9 : 30e9,
        },
    },

    // Block explorer verification
    etherscan: {
        apiKey: {
            conflux: process.env.CONFLUXSCAN_API_KEY || "confluxscan",
            confluxTestnet: process.env.CONFLUXSCAN_API_KEY || "confluxscan",
        },
        customChains: [
            {
                network: "conflux",
                chainId: 1030,
                urls: {
                    // Base API URL
                    apiURL: "https://evmapi.confluxscan.org/api",
                    browserURL: "https://evm.confluxscan.org",
                },
            },
            {
                network: "confluxTestnet",
                chainId: 71,
                urls: {
                    apiURL: "https://evmapi-testnet.confluxscan.org/api",
                    browserURL: "https://evmtestnet.confluxscan.org",
                },
            },
        ],
    },

    // Gas reporting for optimization
    gasReporter: {
        enabled: false,
        currency: "USD",
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        token: "CFX",
        gasPriceApi: "https://evmapi-testnet.confluxscan.org/api?module=proxy&action=eth_gasPrice",
        showTimeSpent: true,
        showMethodSig: true,
    },
};

export default config;

