import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { TRADING_CORE_ADDRESS, TRADING_CORE_ABI } from './useProgram';
import { useMemo } from 'react';
import { formatUnits } from 'viem';

export interface Position {
    id: string;
    /** On-chain `position.size` (internal units) as decimal string — use for close math, not `Number(id)`. */
    sizeRaw: string;
    marketAddress: string;
    size: string;
    collateral: string;
    averagePrice: string;
    entryPrice: string;
    markPrice: string;
    pnl: string;
    leverage: string;
    isLong: boolean;
    liquidationPrice: string;
    stopLossPrice: number;
    takeProfitPrice: number;
}

export function usePositions() {
    const { address, isConnected } = useAccount();

    const { data: positionIds, isLoading: isLoadingIds, refetch: refetchIds } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'getUserPositions',
        args: address ? [address] : undefined,
        query: {
            enabled: !!address && isConnected,
            refetchInterval: 10000,
        }
    });

    const ids = positionIds as readonly bigint[] | undefined;

    const positionContracts = useMemo(() => {
        if (!ids?.length) return [];
        return ids.map((id) => ({
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'getPosition',
            args: [id]
        }));
    }, [ids]);

    const { data: positionsData, isLoading: isLoadingPositions } = useReadContracts({
        contracts: positionContracts as any,
        query: {
            enabled: positionContracts.length > 0,
            refetchInterval: 10000,
        }
    });

    const pnlContracts = useMemo(() => {
        if (!ids?.length) return [];
        return ids.map((id) => ({
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'getPositionPnL',
            args: [id]
        }));
    }, [ids]);

    const { data: pnlData, isLoading: isLoadingPnL } = useReadContracts({
        contracts: pnlContracts as any,
        query: {
            enabled: pnlContracts.length > 0,
            refetchInterval: 5000,
        }
    });

    const formattedPositions: Position[] = useMemo(() => {
        if (!ids || !positionsData) return [];

        return ids.map((id, index) => {
            const posResult = positionsData[index];
            const pnlResult = pnlData?.[index];

            if (!posResult || posResult.status !== 'success' || !posResult.result) return null;

            const pos = posResult.result as any;
            const pnlVal = pnlResult && pnlResult.status === 'success' ? (pnlResult.result as any)[0] : 0n;

            const sizeNum = parseFloat(formatUnits(pos.size, 18));
            const entryPriceNum = parseFloat(formatUnits(pos.entryPrice, 18));
            const pnlNum = parseFloat(formatUnits(pnlVal, 6));
            let markPriceNum = entryPriceNum;
            if (sizeNum > 0 && entryPriceNum > 0) {
                if (pos.flags & 1) { // Long
                    markPriceNum = entryPriceNum + (pnlNum * entryPriceNum) / sizeNum;
                } else { // Short
                    markPriceNum = entryPriceNum - (pnlNum * entryPriceNum) / sizeNum;
                }
            }

            const stopLossPrice = pos.stopLossPrice != null ? parseFloat(formatUnits(pos.stopLossPrice, 18)) : 0;
            const takeProfitPrice = pos.takeProfitPrice != null ? parseFloat(formatUnits(pos.takeProfitPrice, 18)) : 0;
            const leverageNum = (Number(pos.leverage) / 1e18) || 1;
            const collateralNum = leverageNum > 0 ? sizeNum / leverageNum : 0;
            return {
                id: id.toString(),
                sizeRaw: (pos.size as bigint).toString(),
                marketAddress: pos.market, // DataTypes.Position.market
                size: sizeNum.toFixed(4),
                collateral: collateralNum.toFixed(2),
                averagePrice: entryPriceNum.toFixed(2),
                entryPrice: entryPriceNum.toFixed(2),
                markPrice: markPriceNum.toFixed(2),
                pnl: pnlNum.toFixed(2),
                leverage: leverageNum.toString(),
                isLong: (pos.flags & 1) === 1,
                liquidationPrice: formatUnits(pos.liquidationPrice, 18),
                stopLossPrice,
                takeProfitPrice,
            };
        }).filter(Boolean) as Position[];
    }, [ids, positionsData, pnlData]);

    return {
        positions: formattedPositions,
        isLoading: isLoadingIds || isLoadingPositions || isLoadingPnL,
        refetch: refetchIds
    };
}
