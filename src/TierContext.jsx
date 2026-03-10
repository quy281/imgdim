import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { TIERS, canUseTier, getTierLimits, getRequiredTier } from './tierConfig';

const TierContext = createContext();

const TIER_STORAGE_KEY = 'mkg_dim_tier';
const USER_STORAGE_KEY = 'mkg_dim_user';

export function TierProvider({ children }) {
    // Persist tier in localStorage
    const [currentTier, setCurrentTierState] = useState(() => {
        try { return localStorage.getItem(TIER_STORAGE_KEY) || TIERS.FREE; }
        catch { return TIERS.FREE; }
    });
    const [user, setUserState] = useState(() => {
        try { const u = localStorage.getItem(USER_STORAGE_KEY); return u ? JSON.parse(u) : null; }
        catch { return null; }
    });
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState(null);

    const setCurrentTier = useCallback((tier) => {
        setCurrentTierState(tier);
        try { localStorage.setItem(TIER_STORAGE_KEY, tier); } catch { }
    }, []);

    const setUser = useCallback((userData) => {
        setUserState(userData);
        try {
            if (userData) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
            else localStorage.removeItem(USER_STORAGE_KEY);
        } catch { }
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        setCurrentTier(TIERS.FREE);
    }, [setUser, setCurrentTier]);

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
            user,
            setUser,
            logout,
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
