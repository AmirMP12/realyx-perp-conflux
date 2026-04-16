import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { TRADING_CORE_ADDRESS } from '../contracts';
import { formatUnits, parseAbiItem } from 'viem';
import { TradeHistoryItem } from './useBackend';

const START_BLOCK = 160000000n; // Default for Conflux eSpace testnet

export function useOnChainHistory() {
    const { address } = useAccount();
    const publicClient = usePublicClient();

    return useQuery({
        queryKey: ['onchain-history', address],
        queryFn: async (): Promise<TradeHistoryItem[]> => {
            if (!address || !publicClient) return [];

            try {
                // 1. Fetch PositionOpened logs for the user (to get all position IDs owned by user)
                const openLogs = await publicClient.getLogs({
                    address: TRADING_CORE_ADDRESS,
                    event: parseAbiItem('event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)'),
                    args: { trader: address },
                    fromBlock: START_BLOCK
                });

                const userPositionIds = openLogs.map(log => log.args.positionId);
                
                // 2. Fetch PositionClosed logs for the user
                const closeLogs = await publicClient.getLogs({
                    address: TRADING_CORE_ADDRESS,
                    event: parseAbiItem('event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)'),
                    args: { trader: address },
                    fromBlock: START_BLOCK
                });

                // 3. Fetch PositionLiquidated logs for the user's positions
                // Since liquidator is indexed but trader isn't, we fetch by positionId list if it's not too large
                let liquidationLogs: any[] = [];
                if (userPositionIds.length > 0) {
                   liquidationLogs = await publicClient.getLogs({
                        address: TRADING_CORE_ADDRESS,
                        event: parseAbiItem('event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)'),
                        fromBlock: START_BLOCK
                    });
                    // Filter for user's positions manually
                    liquidationLogs = liquidationLogs.filter(log => userPositionIds.includes(log.args.positionId));
                }

                const combinedLogs = [...openLogs, ...closeLogs, ...liquidationLogs];
                const uniqueBlocks = Array.from(new Set(combinedLogs.map(l => l.blockNumber)));
                const blockMap = new Map<bigint, string>();
                
                // Fetch timestamps in chunks to avoid RPC limits
                for (let i = 0; i < uniqueBlocks.length; i += 10) {
                    const chunk = uniqueBlocks.slice(i, i + 10);
                    const blocks = await Promise.all(chunk.map(b => publicClient.getBlock({ blockNumber: b })));
                    blocks.forEach(b => blockMap.set(b.number, new Date(Number(b.timestamp) * 1000).toISOString()));
                }

                const allTrades: TradeHistoryItem[] = [];

                // Helper to find market/side from openLogs
                const getOpenInfo = (id: bigint) => {
                   const log = openLogs.find(l => l.args.positionId === id);
                   return log ? { 
                       market: log.args.market, 
                       isLong: log.args.isLong, 
                       leverage: Number(log.args.leverage) / 1e18,
                       size: formatUnits(log.args.size || 0n, 18)
                   } : null;
                };

                // Add Opens
                for (const log of openLogs) {
                    allTrades.push({
                        id: Number(log.args.positionId),
                        signature: `${log.transactionHash}-open`,
                        market: String(log.args.market), 
                        side: log.args.isLong ? 'LONG' : 'SHORT',
                        size: formatUnits(log.args.size || 0n, 18),
                        price: formatUnits(log.args.entryPrice || 0n, 18),
                        leverage: Number(log.args.leverage || 0n) / 1e18,
                        fee: '0',
                        pnl: null,
                        type: 'OPEN',
                        timestamp: blockMap.get(log.blockNumber) || new Date().toISOString()
                    });
                }

                // Add Closes
                for (const log of closeLogs) {
                    const info = getOpenInfo(log.args.positionId!);
                    allTrades.push({
                        id: Number(log.args.positionId),
                        signature: `${log.transactionHash}-close`,
                        market: String(info?.market || '0x'),
                        side: info?.isLong ? 'LONG' : 'SHORT',
                        size: '0', 
                        price: formatUnits(log.args.exitPrice || 0n, 18),
                        leverage: info?.leverage || 0,
                        fee: formatUnits(log.args.closingFee || 0n, 18),
                        pnl: formatUnits(log.args.realizedPnL || 0n, 18),
                        type: 'CLOSE',
                        timestamp: blockMap.get(log.blockNumber) || new Date().toISOString()
                    });
                }

                // Add Liquidations
                for (const log of liquidationLogs) {
                    const info = getOpenInfo(log.args.positionId!);
                    const sizeNum = info ? parseFloat(info.size || '0') : 0;
                    const leverageNum = info ? info.leverage || 1 : 1;
                    const lostMargin = leverageNum > 0 ? sizeNum / leverageNum : 0;

                    allTrades.push({
                        id: Number(log.args.positionId),
                        signature: `${log.transactionHash}-liq`,
                        market: String(info?.market || '0x'),
                        side: info?.isLong ? 'LONG' : 'SHORT',
                        size: '0',
                        price: formatUnits(log.args.liquidationPrice || 0n, 18),
                        leverage: info?.leverage || 0,
                        fee: formatUnits(log.args.liquidationFee || 0n, 18),
                        pnl: (-lostMargin).toFixed(2), // Liquidation is a loss of margin
                        type: 'LIQUIDATED',
                        timestamp: blockMap.get(log.blockNumber) || new Date().toISOString()
                    });
                }

                return allTrades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            } catch (err) {
                console.error("On-chain history fetch failed:", err);
                return [];
            }
        },
        enabled: !!address && !!publicClient,
        staleTime: 30000
    });
}
