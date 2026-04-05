import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';

export function WalletConnectButton() {
    return (
        <ConnectButton
            showBalance={false}
            accountStatus="address"
            chainStatus="icon"
            label="Connect Wallet"
        />
    );
}

export function useWalletConnection() {
    const { address, isConnected } = useAccount();
    return {
        isConnected,
        address: address,
    };
}
