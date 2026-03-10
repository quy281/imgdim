import React, { createContext, useContext, useState, useCallback } from 'react';
import { TIERS, canUseTier, getTierLimits, getRequiredTier } from './tierConfig';

const TierContext = createContext();

export function TierProvider({ children }) {
    // Default tier = FREE. In real app, this would come from auth/payment status.
    const [currentTier, setCurrentTier] = useState(TIERS.FREE);
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState(null);

    const canUse = useCallback((feature) => {
        return canUseTier(currentTier, feature);
    }, [currentTier]);

    const limits = getTierLimits(currentTier);

    const requireFeature = useCallback((feature) => {
        if (canUseTier(currentTier, feature)) return true;
        setUpgradeFeature(feature);
        setShowUpgrade(true);
        return false;
    }, [currentTier]);

    const dismissUpgrade = useCallback(() => {
        setShowUpgrade(false);
        setUpgradeFeature(null);
    }, []);

    return (
        <TierContext.Provider value={{
            currentTier,
            setCurrentTier,
            canUse,
            limits,
            requireFeature,
            showUpgrade,
            upgradeFeature,
            dismissUpgrade,
        }}>
            {children}
        </TierContext.Provider>
    );
}

export function useTier() {
    const ctx = useContext(TierContext);
    if (!ctx) throw new Error('useTier must be used within TierProvider');
    return ctx;
}

export { getRequiredTier };
