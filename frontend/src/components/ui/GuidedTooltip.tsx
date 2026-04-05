import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X } from 'lucide-react';

const STORAGE_PREFIX = 'realyx_tooltip_';

interface GuidedTooltipProps {
    id: string;
    title: string;
    content: string;
    children: React.ReactNode;
}

export function GuidedTooltip({ id, title, content, children }: GuidedTooltipProps) {
    const [show, setShow] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const key = STORAGE_PREFIX + id;
        const seen = localStorage.getItem(key);
        if (!seen) setShow(true);
        setDismissed(!!seen);
    }, [id]);

    const handleDismiss = () => {
        localStorage.setItem(STORAGE_PREFIX + id, 'true');
        setShow(false);
        setDismissed(true);
    };

    return (
        <span className="relative inline-flex items-center gap-1">
            {children}
            {!dismissed && (
                <button
                    onClick={() => setShow(!show)}
                    className="p-0.5 rounded text-text-muted hover:text-[var(--primary)] transition-colors"
                    aria-label="Help"
                >
                    <HelpCircle className="w-3.5 h-3.5" />
                </button>
            )}
            <AnimatePresence>
                {show && (
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute left-0 top-full mt-1 z-[100] w-64 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] shadow-xl"
                    >
                        <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-xs font-bold text-text-primary">{title}</span>
                            <button onClick={handleDismiss} className="p-0.5 text-text-muted hover:text-text-primary">
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                        <p className="text-[11px] text-text-secondary leading-relaxed">{content}</p>
                        <button
                            onClick={handleDismiss}
                            className="mt-2 text-[10px] font-medium text-[var(--primary)] hover:underline"
                        >
                            Got it
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </span>
    );
}
