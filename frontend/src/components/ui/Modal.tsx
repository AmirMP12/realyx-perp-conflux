import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    size?: ModalSize;
    /** Hide the default close (X) button in the header. */
    hideClose?: boolean;
}

const SIZE: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
};

/**
 * Accessible modal primitive built on Headless UI Dialog: focus trap, ESC to
 * close, scroll lock, and ARIA wiring out of the box. Theme-aware surface.
 * Use for new dialogs instead of hand-rolled fixed/backdrop markup.
 */
export function Modal({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
    hideClose = false,
}: ModalProps) {
    return (
        <Dialog open={open} onClose={onClose} className="relative z-[100]">
            <DialogBackdrop
                transition
                className="fixed inset-0 bg-black/70 backdrop-blur-sm transition duration-200 ease-out data-closed:opacity-0 motion-reduce:transition-none"
                aria-hidden="true"
            />
            <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                <DialogPanel
                    transition
                    className={clsx(
                        'glass-panel-elevated w-full rounded-b-none sm:rounded-[var(--radius-panel)]',
                        'p-5 sm:p-6 transition duration-200 ease-out',
                        'data-closed:opacity-0 data-closed:translate-y-4 sm:data-closed:translate-y-0 sm:data-closed:scale-95',
                        'motion-reduce:transition-none',
                        SIZE[size],
                    )}
                >
                    {(title || !hideClose) && (
                        <div className="flex items-start justify-between gap-4 mb-4">
                            <div className="min-w-0">
                                {title ? (
                                    <DialogTitle className="text-lg font-bold tracking-tight text-text-primary">
                                        {title}
                                    </DialogTitle>
                                ) : null}
                                {description ? (
                                    <p className="mt-1 text-sm text-text-secondary">{description}</p>
                                ) : null}
                            </div>
                            {!hideClose && (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Close dialog"
                                    className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    )}

                    <div className="min-w-0">{children}</div>

                    {footer ? (
                        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>
                    ) : null}
                </DialogPanel>
            </div>
        </Dialog>
    );
}

export default Modal;
