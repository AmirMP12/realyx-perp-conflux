import { useState, useEffect, useCallback } from 'react';

const HERMES_BASE = 'https://hermes.pyth.network';

/** Pyth price feed IDs for known markets (used when contract/oracle price is 0) */
export const PYTH_FEED_BY_MARKET: Record<string, string> = {
    // Crypto majors
    '0x986a383f6de4a24dd3f524f0f93546229b58265f': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC-USD
    '0x886a383f6de4a24dd3f524f0f93546229b58265f': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH-USD
    '0x906a383f6de4a24dd3f524f0f93546229b58265f': '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221', // LINK-USD
    '0x926a383f6de4a24dd3f524f0f93546229b58265f': '0x39d020f60982ed892abbcd4a06a276a9f9b7bfbce003204c110b6e488f502da3', // SNX-USD
    '0x936a383f6de4a24dd3f524f0f93546229b58265f': '0x9a4df90b25497f66b1afb012467e316e801ca3d839456db028892fe8c70c8016', // PENDLE-USD
    '0x086a383f6de4a24dd3f524f0f93546229b58265f': '0xd40472610abe56d36d065a0cf889fc8f1dd9f3b7f2a478231a5fc6df07ea5ce3', // ONDO-USD
    '0x286a383f6de4a24dd3f524f0f93546229b58265f': '0x44465e17d2e9d390e70c999d5a11fda4f092847fcd2e3e5aa089d96c98a30e67', // XAUT-USD

    // Equities / RWAs
    '0x786a383f6de4a24dd3f524f0f93546229b58265f': '0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f', // NVDAX-USD
    '0x686a383f6de4a24dd3f524f0f93546229b58265f': '0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362', // TSLAX-USD
    '0x586a383f6de4a24dd3f524f0f93546229b58265f': '0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900', // METAX-USD
    '0x486a383f6de4a24dd3f524f0f93546229b58265f': '0xc13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758', // CRCLX-USD
    '0x386a383f6de4a24dd3f524f0f93546229b58265f': '0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e', // GOOGLX-USD
    '0x946a383f6de4a24dd3f524f0f93546229b58265f': '0x02a67e6184e6c9dd65e14745a2a80df8b2b3d2ca91b4b191404936003d9929ae', // NFLXX-USD
    '0x956a383f6de4a24dd3f524f0f93546229b58265f': '0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675', // AAPLX-USD
    '0x966a383f6de4a24dd3f524f0f93546229b58265f': '0x641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f', // COINX-USD
    '0x976a383f6de4a24dd3f524f0f93546229b58265f': '0x27cac3c00ed32285b8686611bbc4a654279c1ea11ab4dc90822c2edd20734bca', // MCDX-USD
    '0x996a383f6de4a24dd3f524f0f93546229b58265f': '0x178a6f73a5aede9d0d682e86b0047c9f333ed0efe5c6537ca937565219c4054d', // QQQX-USD
    '0x006a383f6de4a24dd3f524f0f93546229b58265f': '0xdd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9', // HOODX-USD
    '0x116a383f6de4a24dd3f524f0f93546229b58265f': '0x53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28', // MSTRX-USD
    '0x706a383f6de4a24dd3f524f0f93546229b58265f': '0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14', // SPYX-USD
};

function parsePythPrice(priceStr: string, expo: number): number {
    const p = Number(priceStr);
    if (!Number.isFinite(p)) return 0;
    return p * Math.pow(10, expo);
}

export function usePythDisplayPrice(feedId: string | undefined) {
    const [price, setPrice] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchPrice = useCallback(async () => {
        if (!feedId) {
            setPrice(null);
            return;
        }
        setLoading(true);
        setPrice(null);
        try {
            const id = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
            const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${id}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            const parsed = data?.parsed?.[0];
            if (!parsed?.price) return;
            const { price: p, expo } = parsed.price;
            const normalized = parsePythPrice(String(p), Number(expo));
            if (normalized > 0) setPrice(normalized);
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    }, [feedId]);

    useEffect(() => {
        fetchPrice();
        const t = feedId ? setInterval(fetchPrice, 15_000) : undefined;
        return () => { if (t) clearInterval(t); };
    }, [feedId, fetchPrice]);

    return { price, loading, refetch: fetchPrice };
}

export const PYTH_FEED_BY_SYMBOL: Record<string, string> = {
    'BTC-USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'ETH-USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'LINK-USD': '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
    'SNX-USD': '0x39d020f60982ed892abbcd4a06a276a9f9b7bfbce003204c110b6e488f502da3',
    'PENDLE-USD': '0x9a4df90b25497f66b1afb012467e316e801ca3d839456db028892fe8c70c8016',
    'ONDO-USD': '0xd40472610abe56d36d065a0cf889fc8f1dd9f3b7f2a478231a5fc6df07ea5ce3',
    'XAUT-USD': '0x44465e17d2e9d390e70c999d5a11fda4f092847fcd2e3e5aa089d96c98a30e67',

    // Equities
    'NVDAX-USD': '0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f',
    'TSLAX-USD': '0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362',
    'METAX-USD': '0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900',
    'CRCLX-USD': '0xc13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758',
    'GOOGLX-USD': '0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e',
    'NFLXX-USD': '0x02a67e6184e6c9dd65e14745a2a80df8b2b3d2ca91b4b191404936003d9929ae',
    'AAPLX-USD': '0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675',
    'COINX-USD': '0x641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f',
    'MCDX-USD': '0x27cac3c00ed32285b8686611bbc4a654279c1ea11ab4dc90822c2edd20734bca',
    'QQQX-USD': '0x178a6f73a5aede9d0d682e86b0047c9f333ed0efe5c6537ca937565219c4054d',
    'HOODX-USD': '0xdd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9',
    'MSTRX-USD': '0x53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28',
    'SPYX-USD': '0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14',
};

/** Get Pyth feed ID for a market address (for display fallback) */
export function getPythFeedId(marketAddress: string, symbol?: string): string | undefined {
    // Try address first
    if (marketAddress) {
        const byAddr = PYTH_FEED_BY_MARKET[marketAddress.toLowerCase()];
        if (byAddr) return byAddr;
    }
    // Try symbol fallback
    if (symbol) {
        return PYTH_FEED_BY_SYMBOL[symbol.toUpperCase()];
    }
    return undefined;
}
