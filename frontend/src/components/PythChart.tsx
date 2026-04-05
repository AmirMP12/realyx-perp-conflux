import { useEffect, useRef, memo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { usePythPriceHistory } from '../hooks/usePythPriceHistory';
import { Loader2 } from 'lucide-react';

interface PythChartProps {
    feedId: string | undefined;
    marketSymbol?: string;
    interval?: number; // minutes between data points
    points?: number; // number of data points
}

/**
 * Price chart component that uses Pyth Network price feeds
 * Displays candlestick chart with historical price data
 */
function PythChartComponent({ feedId, marketSymbol, interval = 60, points = 24 }: PythChartProps) {
    const { data, loading, error } = usePythPriceHistory(feedId, interval, points);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9ca3af',
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight || 400,
            grid: {
                vertLines: { color: 'rgba(55, 65, 81, 0.3)' },
                horzLines: { color: 'rgba(55, 65, 81, 0.3)' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: 'rgba(55, 65, 81, 0.5)',
            },
            rightPriceScale: {
                borderColor: 'rgba(55, 65, 81, 0.5)',
            },
            crosshair: {
                mode: 1, // Magnet mode
                vertLine: {
                    color: 'rgba(100, 116, 139, 0.5)',
                    width: 1,
                    style: 2,
                },
                horzLine: {
                    color: 'rgba(100, 116, 139, 0.5)',
                    width: 1,
                    style: 2,
                },
            },
        });

        chartRef.current = chart;

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
        });

        candlestickSeriesRef.current = candlestickSeries;

        window.addEventListener('resize', handleResize);

        handleResize();

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    useEffect(() => {
        if (candlestickSeriesRef.current && data.length > 0) {
            const chartData = data.map((d) => ({
                time: d.time as UTCTimestamp,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
            }));

            candlestickSeriesRef.current.setData(chartData);
            if (chartRef.current) {
                chartRef.current.timeScale().fitContent();
            }
        }
    }, [data]);

    if (!feedId) {
        return (
            <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center text-text-muted">
                <p className="font-medium text-text-secondary">Select a market</p>
                <p className="mt-1 text-xs">Choose a market to view the price chart.</p>
            </div>
        );
    }

    if (loading && data.length === 0) {
        return (
            <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center text-text-muted">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
                <p className="mt-3 text-sm">Loading price data from Pyth Network...</p>
                {marketSymbol && (
                    <p className="mt-1 text-xs text-text-muted">{marketSymbol}</p>
                )}
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center text-text-muted">
                <p className="font-medium text-rose-400">Error loading chart</p>
                <p className="mt-1 text-xs">{error}</p>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full min-h-[400px]">
            {/* Loading overlay for refreshes */}
            {loading && data.length > 0 && (
                <div className="absolute top-2 right-2 z-10">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)]" />
                </div>
            )}

            {/* Pyth attribution */}
            <div className="absolute bottom-2 left-2 z-10 text-[10px] text-text-muted/50 flex items-center gap-1">
                <span>Powered by</span>
                <span className="font-medium text-[var(--primary)]/70">Pyth Network</span>
            </div>

            <div
                ref={chartContainerRef}
                className="w-full h-full"
            />
        </div>
    );
}

export const PythChart = memo(PythChartComponent);
