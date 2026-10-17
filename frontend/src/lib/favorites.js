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

// Subscribe to storage events
const subscribe = (onStoreChange) => {
  const handleStorageChange = (e) => {
    if (e.key === STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStorageChange);
  return () => {
    window.removeEventListener('storage', handleStorageChange);
  };
};

// Get the current snapshot (used by useSyncExternalStore)
const getSnapshot = getFavoritesFromStorage;

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const toggleFavorite = useCallback((productId) => {
    const newFavorites = favorites.includes(productId)
      ? favorites.filter((id) => id !== productId)
      : [...favorites, productId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
  }, [favorites]);

  const clearFavorites = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return [favorites, toggleFavorite, clearFavorites];
}