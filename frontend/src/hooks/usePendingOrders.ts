import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { TRADING_CORE_ADDRESS } from './useProgram';

const MAX_BLOCK_RANGE = 49_000;

export interface PendingOrder {
    orderId: bigint;
    orderType: number;      // 0=MARKET_INCREASE, 1=MARKET_DECREASE, 2=LIMIT_INCREASE, 3=LIMIT_DECREASE
    market: string;
    timestamp?: number;
}

const ORDER_TYPE_LABELS: Record<number, string> = {
    0: 'Market Increase',
    1: 'Market Decrease',
    2: 'Limit Increase',
    3: 'Limit Decrease',
};

export function getOrderTypeLabel(type: number) {
    return ORDER_TYPE_LABELS[type] ?? `Unknown (${type})`;
}

const ORDER_CREATED_EVENT = {
    type: 'event' as const,
    name: 'OrderCreated',
    inputs: [
        { indexed: true, name: 'orderId', type: 'uint256' },
        { indexed: true, name: 'account', type: 'address' },
        { indexed: false, name: 'orderType', type: 'uint8' },
        { indexed: false, name: 'market', type: 'address' },
    ],
};

const ORDER_EXECUTED_EVENT = {
    type: 'event' as const,
    name: 'OrderExecuted',
    inputs: [
        { indexed: true, name: 'orderId', type: 'uint256' },
        { indexed: false, name: 'positionId', type: 'uint256' },
        { indexed: true, name: 'keeper', type: 'address' },
    ],
};

const ORDER_CANCELLED_EVENT = {
    type: 'event' as const,
    name: 'OrderCancelled',
    inputs: [
        { indexed: true, name: 'orderId', type: 'uint256' },
        { indexed: false, name: 'reason', type: 'string' },
    ],
};

export function usePendingOrders() {
    const { address } = useAccount();
    const publicClient = usePublicClient();
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchOrders = useCallback(async () => {
        if (!publicClient || !address) {
            setOrders([]);
            return;
        }

        setLoading(true);
        try {
            const blockNumber = await publicClient.getBlockNumber();
            const fromBlock = blockNumber > BigInt(MAX_BLOCK_RANGE) ? blockNumber - BigInt(MAX_BLOCK_RANGE) : 0n;

            const blockRange = { fromBlock, toBlock: 'latest' as const };

            // Fetch all OrderCreated events for this user (indexed account)
            const createdLogs = await publicClient.getLogs({
                address: TRADING_CORE_ADDRESS,
                event: ORDER_CREATED_EVENT as any,
                args: { account: address },
                ...blockRange,
            });

            if (createdLogs.length === 0) {
                setOrders([]);
                setLoading(false);
                return;
            }

            // Fetch executed and cancelled events in same block range
            const [executedLogs, cancelledLogs] = await Promise.all([
                publicClient.getLogs({
                    address: TRADING_CORE_ADDRESS,
                    event: ORDER_EXECUTED_EVENT as any,
                    ...blockRange,
                }),
                publicClient.getLogs({
                    address: TRADING_CORE_ADDRESS,
                    event: ORDER_CANCELLED_EVENT as any,
                    ...blockRange,
                }),
            ]);

            const executedIds = new Set(
                executedLogs.map(l => ((l as any).args?.orderId as bigint)?.toString()).filter(Boolean)
            );
            const cancelledIds = new Set(
                cancelledLogs.map(l => ((l as any).args?.orderId as bigint)?.toString()).filter(Boolean)
            );

            // Filter to pending (not executed, not cancelled)
            const pending: PendingOrder[] = [];
            for (const log of createdLogs) {
                const args = (log as any).args;
                const orderId = args?.orderId as bigint;
                if (!orderId) continue;
                const idStr = orderId.toString();
                if (executedIds.has(idStr) || cancelledIds.has(idStr)) continue;

                pending.push({
                    orderId,
                    orderType: Number(args?.orderType ?? 0),
                    market: (args?.market as string) ?? '',
                });
            }

            setOrders(pending);
        } catch (err) {
            console.error('Failed to fetch pending orders:', err);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, [publicClient, address]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    return { orders, loading, refetch: fetchOrders };
}
