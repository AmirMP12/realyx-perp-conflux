/** Shared market metadata for both indexer and frontend-facing routes. */

export type MarketCategory = "CRYPTO" | "STOCK" | "COMMODITY" | "FOREX";

export const MARKET_META: Record<string, { name: string; symbol: string; image: string; category: MarketCategory }> = {
  "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": {
    name: "Conflux",
    symbol: "CFX-USD",
    category: "CRYPTO",
    image: "https://assets.coingecko.com/coins/images/13079/small/3vuYMbjN.png",
  },
  "0x986a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Bitcoin",
    symbol: "BTC-USD",
    category: "CRYPTO",
    image: "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png",
  },
  "0x886a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Ethereum",
    symbol: "ETH-USD",
    category: "CRYPTO",
    image: "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png",
  },
  "0x286a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Tether Gold",
    symbol: "XAUT-USD",
    category: "COMMODITY",
    image: "https://coin-images.coingecko.com/coins/images/10481/small/Tether_Gold.png",
  },
  "0x786a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "NVIDIA",
    symbol: "NVDAX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55633/large/Ticker_NVDA__Company_Name_NVIDIA_Corp__size_200x200_2x.png",
  },
  "0x686a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Tesla",
    symbol: "TSLAX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55638/large/Ticker_TSLA__Company_Name_Tesla_Inc.__size_200x200_2x.png",
  },
  "0x586a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Meta",
    symbol: "METAX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55628/large/Ticker_META__Company_Name_Meta_Platforms_Inc.__size_200x200_2x.png",
  },
  "0x486a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Circle",
    symbol: "CRCLX-USD",
    category: "CRYPTO",
    image: "https://coin-images.coingecko.com/coins/images/66918/large/CRCLx.png",
  },
  "0x386a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Alphabet",
    symbol: "GOOGLX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55610/large/Ticker_GOOG__Company_Name_Alphabet_Inc.__size_200x200_2x.png",
  },
  "0x946a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Netflix",
    symbol: "NFLXX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55632/large/Ticker_NFLX__Company_Name_Netflix_Inc.__size_200x200_2x.png",
  },
  "0x956a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Apple",
    symbol: "AAPLX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55586/large/Ticker_AAPL__Company_Name_Apple_Inc.__size_200x200_2x.png",
  },
  "0x966a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Coinbase",
    symbol: "COINX-USD",
    category: "CRYPTO",
    image: "https://coin-images.coingecko.com/coins/images/55602/large/Ticker_COIN__Company_Name_Coinbase__size_200x200_2x.png",
  },
  "0x976a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "McDonald's",
    symbol: "MCDX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55625/large/Ticker_MCD__Company_Name_McDonalds__size_200x200_2x.png",
  },
  "0x006a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Robinhood",
    symbol: "HOODX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55613/large/Ticker_HOOD__Company_Name_Robinhood__size_200x200_2x.png",
  },
  "0x116a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "MicroStrategy",
    symbol: "MSTRX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/55631/large/Ticker_MSTR__Company_Name_MicroStrategy__size_200x200_2x.png",
  },
  "0x706a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "S&P 500",
    symbol: "SPYX-USD",
    category: "STOCK",
    image: "https://coin-images.coingecko.com/coins/images/68655/large/spyon_160x160.png",
  },
};
