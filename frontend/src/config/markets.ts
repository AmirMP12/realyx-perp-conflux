/** Asset category labels and styles for filter recognition */
export const CATEGORY_CONFIG: Record<string, { label: string; className: string }> = {
    CRYPTO: { label: "Crypto", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    STOCK: { label: "Equities", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    COMMODITY: { label: "Commodities", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    FOREX: { label: "Forex", className: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
};

export const MARKET_DISPLAY_FALLBACK: Record<string, { name: string; symbol: string; image: string }> = {
    "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": { name: "Conflux", symbol: "CFX-USD", image: "https://coin-images.coingecko.com/coins/images/13043/large/conflux-logo.png" },
    "0x986a383f6de4a24dd3f524f0f93546229b58265f": { name: "Bitcoin", symbol: "BTC-USD", image: "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png" },
    "0x886a383f6de4a24dd3f524f0f93546229b58265f": { name: "Ethereum", symbol: "ETH-USD", image: "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png" },
    "0x286a383f6de4a24dd3f524f0f93546229b58265f": { name: "Tether Gold", symbol: "XAUT-USD", image: "https://coin-images.coingecko.com/coins/images/10481/small/Tether_Gold.png" },
    "0x786a383f6de4a24dd3f524f0f93546229b58265f": { name: "NVIDIA", symbol: "NVDAX-USD", image: "https://coin-images.coingecko.com/coins/images/55633/large/Ticker_NVDA__Company_Name_NVIDIA_Corp__size_200x200_2x.png" },
    "0x686a383f6de4a24dd3f524f0f93546229b58265f": { name: "Tesla", symbol: "TSLAX-USD", image: "https://coin-images.coingecko.com/coins/images/55638/large/Ticker_TSLA__Company_Name_Tesla_Inc.__size_200x200_2x.png" },
    "0x586a383f6de4a24dd3f524f0f93546229b58265f": { name: "Meta", symbol: "METAX-USD", image: "https://coin-images.coingecko.com/coins/images/55628/large/Ticker_META__Company_Name_Meta_Platforms_Inc.__size_200x200_2x.png" },
    "0x486a383f6de4a24dd3f524f0f93546229b58265f": { name: "Circle", symbol: "CRCLX-USD", image: 'https://coin-images.coingecko.com/coins/images/66918/large/CRCLx.png' },
    "0x386a383f6de4a24dd3f524f0f93546229b58265f": { name: "Alphabet", symbol: "GOOGLX-USD", image: "https://coin-images.coingecko.com/coins/images/55610/large/Ticker_GOOG__Company_Name_Alphabet_Inc.__size_200x200_2x.png" },
    "0x946a383f6de4a24dd3f524f0f93546229b58265f": { name: "Netflix", symbol: "NFLXX-USD", image: "https://coin-images.coingecko.com/coins/images/55632/large/Ticker_NFLX__Company_Name_Netflix_Inc.__size_200x200_2x.png" },
    "0x956a383f6de4a24dd3f524f0f93546229b58265f": { name: "Apple", symbol: "AAPLX-USD", image: "https://coin-images.coingecko.com/coins/images/55586/large/Ticker_AAPL__Company_Name_Apple_Inc.__size_200x200_2x.png" },
    "0x966a383f6de4a24dd3f524f0f93546229b58265f": { name: "Coinbase", symbol: "COINX-USD", image: "https://coin-images.coingecko.com/coins/images/55602/large/Ticker_COIN__Company_Name_Coinbase__size_200x200_2x.png" },
    "0x976a383f6de4a24dd3f524f0f93546229b58265f": { name: "McDonald's", symbol: "MCDX-USD", image: "https://coin-images.coingecko.com/coins/images/55625/large/Ticker_MCD__Company_Name_McDonalds__size_200x200_2x.png" },
    "0x006a383f6de4a24dd3f524f0f93546229b58265f": { name: "Robinhood", symbol: "HOODX-USD", image: "https://coin-images.coingecko.com/coins/images/55613/large/Ticker_HOOD__Company_Name_Robinhood__size_200x200_2x.png" },
    "0x116a383f6de4a24dd3f524f0f93546229b58265f": { name: "MicroStrategy", symbol: "MSTRX-USD", image: "https://coin-images.coingecko.com/coins/images/55631/large/Ticker_MSTR__Company_Name_MicroStrategy__size_200x200_2x.png" },
    "0x706a383f6de4a24dd3f524f0f93546229b58265f": { name: "S&P 500", symbol: "SPYX-USD", image: "https://coin-images.coingecko.com/coins/images/68655/large/spyon_160x160.png" },
};

