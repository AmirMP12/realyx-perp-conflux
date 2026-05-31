import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from '../ui';

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

    return (
        <Modal
            open={open}
            onClose={handleAccept}
            size="md"
            title={
                <span className="flex items-center gap-2">
                    <span className="p-2 rounded-lg bg-amber-500/10">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                    </span>
                    Risk Disclosure
                </span>
            }
            footer={
                <Button onClick={handleAccept} fullWidth size="lg">
                    I Understand
                </Button>
            }
        >
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
        </Modal>
    );
}
