
import toast, { Toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, X, Info } from 'lucide-react';
import clsx from 'clsx';

export const showToast = (
    type: 'success' | 'error' | 'info',
    title: string,
    message?: string
) => {
    toast.custom((t) => (
        <GlassToast t={t} type={type} title={title} message={message} />
    ));
};

const icons = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info
};

const colors = {
    success: 'text-emerald-400',
    error: 'text-rose-400',
    info: 'text-[var(--primary)]'
};

const bgColors = {
    success: 'bg-emerald-500/10 border-emerald-500/20',
    error: 'bg-rose-500/10 border-rose-500/20',
    info: 'bg-[var(--primary)]/10 border-[var(--primary)]/20'
};

function GlassToast({ t, type, title, message }: { t: Toast, type: 'success' | 'error' | 'info', title: string, message?: string }) {
    const Icon = icons[type];

    return (
        <AnimatePresence>
            {t.visible && (
                <motion.div
                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={clsx(
                        "w-full max-w-sm rounded-xl p-4 shadow-2xl backdrop-blur-xl border pointer-events-auto flex gap-3",
                        "bg-[var(--bg-primary)]/95",
                        bgColors[type]
                    )}
                >
                    <div className={clsx("p-2 rounded-full bg-white/5 h-fit", colors[type])}>
                        <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-white text-sm">{title}</h3>
                        {message && <p className="text-sm text-text-secondary mt-1">{message}</p>}
                    </div>
                    <button
                        onClick={() => toast.dismiss(t.id)}
                        className="text-text-muted hover:text-white transition-colors h-fit p-2 min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg hover:bg-white/10"
                        aria-label="Dismiss notification"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
