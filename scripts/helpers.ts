export type NetworkName = "hardhat" | "localhost" | "conflux" | "confluxTestnet";

export interface NetworkAddresses {
    pyth: string;
    usdc: string;
}

/** Real Pyth contract per network. */
const PYTH_ADDRESSES: Partial<Record<NetworkName, string>> = {
    conflux: "0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc",
    confluxTestnet: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21",
    hardhat: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21",
    localhost: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21",
};

const USDC_CONFLUX: Partial<Record<NetworkName, string>> = {
    conflux: "0x6963EfED0aB40F6C3d478148E8B899E763f24625",
};

export function getPythAddress(network: NetworkName): string | null {
    return PYTH_ADDRESSES[network] ?? null;
}

/** Real Pyth: env PYTH_ADDRESS overrides; otherwise per-network address. */
export function getPythAddressForDeploy(network: NetworkName): string | null {
    const env = process.env.PYTH_ADDRESS;
    if (env) return env;
    return getPythAddress(network);
}

export function hasPythOnNetwork(network: NetworkName): boolean {
    return getPythAddress(network) !== null;
}

/** True if we have a real Pyth to use (env or per-network). */
export function hasRealPythForDeploy(network: NetworkName): boolean {
    return getPythAddressForDeploy(network) !== null;
}

export function getUsdcAddress(network: NetworkName, mockUsdcAddress?: string): string | null {
    if (mockUsdcAddress) return mockUsdcAddress;
    const addr = USDC_CONFLUX[network];
    return addr ?? null;
}

export function getTreasuryAddress(): string {
    const addr = process.env.TREASURY_ADDRESS;
    if (!addr) throw new Error("TREASURY_ADDRESS is required in .env for deployment");
    return addr;
}

export function getUsdcOrThrow(network: NetworkName, mockUsdcAddress?: string): string {
    const addr = getUsdcAddress(network, mockUsdcAddress);
    if (addr) return addr;
    const envUsdc = process.env.USDC_ADDRESS;
    if (envUsdc) return envUsdc;
    throw new Error(`USDC not configured for ${network}. Deploy MockUSDC (testnet) or set USDC_ADDRESS in .env`);
}

export function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is required in .env`);
    return v;
}

export function isTestnet(network: NetworkName): boolean {
    return ["confluxTestnet", "hardhat", "localhost"].includes(network);
}
