import { useSyncExternalStore, useState, useCallback } from 'react';

const STORAGE_KEY = 'mgs_favorites';

// Parse favorites from localStorage, return empty array if invalid or missing
const getFavoritesFromStorage = () => {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : [];
  } catch (e) {
    console.warn('Failed to parse favorites from localStorage', e);
    return [];
  }
};

// Cache the snapshot to prevent infinite loops with useSyncExternalStore
let cachedSnapshot = getFavoritesFromStorage();

// Subscribe to storage events and update cached snapshot
const subscribe = (onStoreChange) => {
  const handleStoreChange = () => {
    const newSnapshot = getFavoritesFromStorage();
    // Only update if the snapshot actually changed
    if (JSON.stringify(newSnapshot) !== JSON.stringify(cachedSnapshot)) {
      cachedSnapshot = newSnapshot;
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStoreChange);
  return () => {
    window.removeEventListener('storage', handleStoreChange);
  };
};

// Get the current snapshot (used by useSyncExternalStore)
const getSnapshot = () => cachedSnapshot;

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const toggleFavorite = useCallback((productId) => {
    const newFavorites = favorites.includes(productId)
      ? favorites.filter((id) => id !== productId)
      : [...favorites, productId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
    // Update our cached snapshot immediately
    cachedSnapshot = newFavorites;
  }, [favorites]);

  const clearFavorites = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    cachedSnapshot = [];
  }, []);

  return [favorites, toggleFavorite, clearFavorites];
}