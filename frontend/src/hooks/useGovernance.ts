import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

// Market parameters for adding new markets
export interface MarketParams {
    collectionId: string;
    name: string;
    maxLeverage: number;
    initialMarginBps: number;
    maintenanceMarginBps: number;
}

// Proposal types
export type ProposalAction =
    | { type: 'UpdateProtocolFee'; feeBps: number }
    | { type: 'UpdateMaxLeverage'; leverage: number }
    | { type: 'PauseMarket'; market: string }
    | { type: 'UnpauseMarket'; market: string }
    | { type: 'AddMarket'; params: MarketParams }
    | { type: 'EmergencyPause' }
    | { type: 'UpdateSigners'; signers: string[]; threshold: number };

export interface Proposal {
    id: number;
    proposer: string;
    action: ProposalAction;
    description: string;
    approvals: string[];
    createdAt: number;
    executeAfter: number;
    executedAt: number | null;
    status: 'Pending' | 'Approved' | 'Executed' | 'Cancelled' | 'Expired';
}

export interface GovernanceState {
    signers: string[];
    threshold: number;
    timelockDelay: number;
    proposalCount: number;
    isPaused: boolean;
}

export function useGovernance() {
    const { address } = useAccount();
    const isConnected = !!address;

    const createProposal = useCallback(async (
        _action: ProposalAction,
        _description: string
    ): Promise<string | null> => {
        if (!isConnected) {
            toast.error('Please connect your wallet');
            return null;
        }

        try {
            toast.loading('Creating proposal...', { id: 'create-proposal' });

            await new Promise(resolve => setTimeout(resolve, 1000));

            toast.success('Proposal created successfully!', { id: 'create-proposal' });
            return 'demo-tx-signature';

        } catch (error: any) {
            console.error('Error creating proposal:', error);
            toast.error(error.message || 'Failed to create proposal', { id: 'create-proposal' });
            return null;
        }
    }, [isConnected]);

    const approveProposal = useCallback(async (_proposalId: number): Promise<boolean> => {
        if (!isConnected) {
            toast.error('Please connect your wallet');
            return false;
        }

        try {
            toast.loading('Approving proposal...', { id: 'approve-proposal' });
            await new Promise(resolve => setTimeout(resolve, 1000));
            toast.success('Proposal approved!', { id: 'approve-proposal' });
            return true;
        } catch (error: any) {
            console.error('Error approving proposal:', error);
            toast.error(error.message || 'Failed to approve proposal', { id: 'approve-proposal' });
            return false;
        }
    }, [isConnected]);

    const executeProposal = useCallback(async (_proposalId: number): Promise<boolean> => {
        if (!isConnected) {
            toast.error('Please connect your wallet');
            return false;
        }

        try {
            toast.loading('Executing proposal...', { id: 'execute-proposal' });
            await new Promise(resolve => setTimeout(resolve, 1000));
            toast.success('Proposal executed!', { id: 'execute-proposal' });
            return true;
        } catch (error: any) {
            console.error('Error executing proposal:', error);
            toast.error(error.message || 'Failed to execute proposal', { id: 'execute-proposal' });
            return false;
        }
    }, [isConnected]);

    const emergencyPause = useCallback(async (): Promise<boolean> => {
        if (!isConnected) {
            toast.error('Please connect your wallet');
            return false;
        }

        try {
            toast.loading('Initiating emergency pause...', { id: 'emergency-pause' });
            await new Promise(resolve => setTimeout(resolve, 1000));
            toast.success('Emergency pause activated!', { id: 'emergency-pause' });
            return true;
        } catch (error: any) {
            console.error('Error with emergency pause:', error);
            toast.error(error.message || 'Failed to pause', { id: 'emergency-pause' });
            return false;
        }
    }, [isConnected]);

    const proposeAddMarket = useCallback(async (
        params: MarketParams,
        description: string
    ): Promise<string | null> => {
        return createProposal(
            { type: 'AddMarket', params },
            description
        );
    }, [createProposal]);

    const proposeUpdateFee = useCallback(async (
        feeBps: number,
        description: string
    ): Promise<string | null> => {
        return createProposal(
            { type: 'UpdateProtocolFee', feeBps },
            description
        );
    }, [createProposal]);

    const proposeUpdateSigners = useCallback(async (
        signers: string[],
        threshold: number,
        description: string
    ): Promise<string | null> => {
        return createProposal(
            { type: 'UpdateSigners', signers, threshold },
            description
        );
    }, [createProposal]);

    return {
        createProposal,
        approveProposal,
        executeProposal,
        emergencyPause,
        proposeAddMarket,
        proposeUpdateFee,
        proposeUpdateSigners,
    };
}

export default useGovernance;

