import { useEffect, useRef, memo } from 'react';

/**
 * Map market symbols to exact TradingView trading pair symbols.
 * Format: exchange:PAIR
 */
const TV_SYMBOL_MAP: Record<string, string> = {
    'BTC-USD': 'BINANCE:BTCUSDT',
    'ETH-USD': 'BINANCE:ETHUSDT',
    'LINK-USD': 'BINANCE:LINKUSDT',
    'SNX-USD': 'BINANCE:SNXUSDT',
    'PENDLE-USD': 'BINANCE:PENDLEUSDT',
    'ONDO-USD': 'BINANCE:ONDOUSDT',
    'XAU-USD': 'TVC:GOLD',
    'XAUT-USD': 'TVC:GOLD',
    'TSLA-USD': 'NASDAQ:TSLA',
    'TSLAX-USD': 'NASDAQ:TSLA',
    'NVDA-USD': 'NASDAQ:NVDA',
    'NVDAX-USD': 'NASDAQ:NVDA',
    'META-USD': 'NASDAQ:META',
    'METAX-USD': 'NASDAQ:META',
    'AAPL-USD': 'NASDAQ:AAPL',
    'AAPLX-USD': 'NASDAQ:AAPL',
    'GOOGL-USD': 'NASDAQ:GOOGL',
    'GOOGLX-USD': 'NASDAQ:GOOGL',
    'COIN-USD': 'NASDAQ:COIN',
    'COINX-USD': 'NASDAQ:COIN',
    'MCD-USD': 'NYSE:MCD',
    'MCDX-USD': 'NYSE:MCD',
    'NFLX-USD': 'NASDAQ:NFLX',
    'NFLXX-USD': 'NASDAQ:NFLX',
    'HOOD-USD': 'NASDAQ:HOOD',
    'HOODX-USD': 'NASDAQ:HOOD',
    'MSTR-USD': 'NASDAQ:MSTR',
    'MSTRX-USD': 'NASDAQ:MSTR',
    'CRCL-USD': 'NYSE:CRCL',
    'CRCLX-USD': 'NYSE:CRCL',
    'SPY-USD': 'AMEX:SPY',
    'SPYX-USD': 'AMEX:SPY',
    'QQQ-USD': 'NASDAQ:QQQ',
    'QQQX-USD': 'NASDAQ:QQQ',
};

/** Map our interval labels to TradingView interval strings */
const TV_INTERVAL_MAP: Record<string, string> = {
    '15m': '15',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
};

interface TradingViewWidgetProps {
    /** Market symbol from our system, e.g. "BTC-USD", "TSLAX-USD" */
    marketSymbol: string | undefined;
    /** Chart interval: '15m' | '1h' | '4h' | '1d' */
    interval?: string;
}

/**
 * TradingView Advanced Chart Widget — fully responsive.
 * Maps each market to the correct exchange:pair on TradingView.
 */
function TradingViewWidgetComponent({ marketSymbol, interval = '1h' }: TradingViewWidgetProps) {
    const container = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!container.current || !marketSymbol) return;

        container.current.innerHTML = '';
        const tvSymbol = TV_SYMBOL_MAP[marketSymbol] ?? TV_SYMBOL_MAP[marketSymbol.toUpperCase()] ?? `BINANCE:${marketSymbol.replace('-USD', '').replace('X', '')}USDT`;
        const tvInterval = TV_INTERVAL_MAP[interval] ?? '60';

        const wrapper = document.createElement('div');
        wrapper.className = 'tradingview-widget-container';
        wrapper.style.height = '100%';
        wrapper.style.width = '100%';

        const widgetDiv = document.createElement('div');
        widgetDiv.className = 'tradingview-widget-container__widget';
        widgetDiv.style.height = '100%';
        widgetDiv.style.width = '100%';
        wrapper.appendChild(widgetDiv);

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.type = 'text/javascript';
        script.async = true;
        script.innerHTML = JSON.stringify({
            autosize: true,
            symbol: tvSymbol,
            interval: tvInterval,
            timezone: 'Etc/UTC',
            theme: 'dark',
            style: '1', // Candlestick
            locale: 'en',
            enable_publishing: false,
            allow_symbol_change: false,
            hide_top_toolbar: true,
            hide_legend: false,
            hide_side_toolbar: true,
            save_image: false,
            calendar: false,
            hide_volume: false,
            support_host: 'https://www.tradingview.com',
            backgroundColor: 'rgba(10, 10, 15, 1)',
            gridColor: 'rgba(40, 40, 50, 0.4)',
            withdateranges: false,
        });

        wrapper.appendChild(script);
        container.current.appendChild(wrapper);

        return () => {
            if (container.current) {
                container.current.innerHTML = '';
            }
        };
    }, [marketSymbol, interval]);

    if (!marketSymbol) {
        return (
            <div className="w-full h-full min-h-[60vh] flex flex-col items-center justify-center text-text-muted">
                <p className="font-medium text-text-secondary">Select a market</p>
                <p className="mt-1 text-xs">Choose a market to view the price chart.</p>
            </div>
        );
    }

    return (
        <div
            ref={container}
            className="w-full h-full min-h-[200px]"
        />
    );
}

export const TradingViewWidget = memo(TradingViewWidgetComponent);
export { TV_SYMBOL_MAP };
