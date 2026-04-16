import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { TRADING_CORE_ADDRESS, TRADING_CORE_ABI } from './useProgram';
import { useCallback, useMemo } from 'react';
import { formatUnits } from 'viem';

/** `DataTypes.PosStatus` on-chain: only `OPEN` positions are tradable / closable. */
const POS_STATUS_OPEN = 1;

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

    const {
        data: positionsData,
        isLoading: isLoadingPositions,
        refetch: refetchPositionDetails,
    } = useReadContracts({
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

    const { data: pnlData, isLoading: isLoadingPnL, refetch: refetchPnls } = useReadContracts({
        contracts: pnlContracts as any,
        query: {
            enabled: pnlContracts.length > 0,
            refetchInterval: 5000,
        }
    });

    const refetch = useCallback(async () => {
        await refetchIds();
        await Promise.all([refetchPositionDetails(), refetchPnls()]);
    }, [refetchIds, refetchPositionDetails, refetchPnls]);

    const formattedPositions: Position[] = useMemo(() => {
        if (!ids?.length || !positionsData) return [];

        return ids.map((id, index) => {
            const posResult = positionsData[index];
            const pnlResult = pnlData?.[index];

            if (!posResult || posResult.status !== 'success' || !posResult.result) return null;

            const pos = posResult.result as any;
            
            const stateRaw = pos.state !== undefined ? pos.state : (pos[12] !== undefined ? pos[12] : POS_STATUS_OPEN);
            const state = Number(stateRaw);
            if (state !== POS_STATUS_OPEN) return null;

            const sizeRaw = pos.size !== undefined ? pos.size : pos[0];
            if (sizeRaw === undefined || BigInt(sizeRaw) === 0n) return null;

            const entryPriceRaw = pos.entryPrice !== undefined ? pos.entryPrice : pos[1];
            const leverageRaw = pos.leverage !== undefined ? pos.leverage : pos[5];
            const stopLossRaw = pos.stopLossPrice !== undefined ? pos.stopLossPrice : pos[3];
            const takeProfitRaw = pos.takeProfitPrice !== undefined ? pos.takeProfitPrice : pos[4];
            const marketAddressRaw = pos.market !== undefined ? pos.market : pos[7];
            const flagsRaw = pos.flags !== undefined ? pos.flags : pos[10];

            const pnlVal = pnlResult && pnlResult.status === 'success' ? (pnlResult.result as any)[0] : 0n;

            const sizeNum = parseFloat(formatUnits(sizeRaw, 18));
            const entryPriceNum = parseFloat(formatUnits(entryPriceRaw, 18));
            const pnlNum = parseFloat(formatUnits(pnlVal, 18));
            let markPriceNum = entryPriceNum;
            if (sizeNum > 0 && entryPriceNum > 0) {
                if (Number(flagsRaw) & 1) { // Long
                    markPriceNum = entryPriceNum + (pnlNum * entryPriceNum) / sizeNum;
                } else { // Short
                    markPriceNum = entryPriceNum - (pnlNum * entryPriceNum) / sizeNum;
                }
            }

            const stopLossPrice = stopLossRaw != null ? parseFloat(formatUnits(stopLossRaw, 18)) : 0;
            const takeProfitPrice = takeProfitRaw != null ? parseFloat(formatUnits(takeProfitRaw, 18)) : 0;
            const leverageNum = (Number(leverageRaw) / 1e18) || 1;
            const collateralNum = leverageNum > 0 ? sizeNum / leverageNum : 0;
            return {
                id: id.toString(),
                sizeRaw: sizeRaw.toString(),
                marketAddress: marketAddressRaw, 
                size: sizeNum.toFixed(4),
                collateral: collateralNum.toFixed(2),
                averagePrice: entryPriceNum.toFixed(2),
                entryPrice: entryPriceNum.toFixed(2),
                markPrice: markPriceNum.toFixed(2),
                pnl: pnlNum.toFixed(2),
                leverage: leverageNum.toString(),
                isLong: (Number(flagsRaw) & 1) !== 0,
                liquidationPrice: "0",
                stopLossPrice: stopLossPrice,
                takeProfitPrice: takeProfitPrice,
                stopLoss: stopLossPrice > 0 ? stopLossPrice.toFixed(2) : undefined,
                takeProfit: takeProfitPrice > 0 ? takeProfitPrice.toFixed(2) : undefined,
                state
            };
        }).filter(Boolean) as Position[];
    }, [ids, positionsData, pnlData]);

    return {
        positions: formattedPositions,
        isLoading: isLoadingIds || isLoadingPositions || isLoadingPnL,
        refetch,
    };
}
