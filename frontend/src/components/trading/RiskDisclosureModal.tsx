import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

const STORAGE_KEY = 'realyx_risk_disclosure_seen';

export function RiskDisclosureModal() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const seen = localStorage.getItem(STORAGE_KEY);
        if (!seen) {
            setOpen(true);
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        setOpen(false);
    };

    const modal = (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200]"
                        onClick={handleAccept}
                        aria-hidden="true"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 flex items-center justify-center p-4 z-[201] pointer-events-none"
                        aria-modal="true"
                        role="dialog"
                        aria-labelledby="risk-disclosure-title"
                    >
                        <div
                            className="w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden pointer-events-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                        <div className="p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className="p-2 rounded-lg bg-amber-500/10">
                                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                                    </div>
                                    <h2 id="risk-disclosure-title" className="text-lg font-bold text-text-primary">Risk Disclosure</h2>
                                </div>
                                <button
                                    onClick={handleAccept}
                                    className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                                    aria-label="Accept"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="text-sm text-text-secondary space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                                <p>
                                    Trading perpetual futures involves substantial risk of loss. You may lose more than your initial margin.
                                </p>
                                <p>
                                    Leverage amplifies both gains and losses. Liquidation can occur when the market moves against your position.
                                </p>
                                <p>
                                    Past performance does not guarantee future results. RWA and equity markets may have different hours and volatility.
                                </p>
                                <p>
                                    Only trade with funds you can afford to lose. This is not financial advice.
                                </p>
                            </div>
                            <button
                                onClick={handleAccept}
                                className="mt-6 w-full py-3 rounded-lg bg-[var(--primary)] text-white font-bold hover:opacity-90 transition-opacity"
                            >
                                I Understand
                            </button>
                        </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );

    return createPortal(modal, document.body);
}
