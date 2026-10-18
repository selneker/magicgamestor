import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "mgs_favorites";

// Parse favorites from localStorage, return an empty array if storage is unavailable or invalid.
const getFavoritesFromStorage = () => {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    const parsed = json ? JSON.parse(json) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to parse favorites from localStorage", e);
    return [];
  }
};

let cachedSnapshot = getFavoritesFromStorage();
const listeners = new Set();

const notify = () => {
  listeners.forEach((listener) => listener());
};

const subscribe = (onStoreChange) => {
  listeners.add(onStoreChange);
  const handleStorage = () => {
    const next = getFavoritesFromStorage();
    if (JSON.stringify(next) !== JSON.stringify(cachedSnapshot)) {
      cachedSnapshot = next;
      notify();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
};

const getSnapshot = () => cachedSnapshot;

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const toggleFavorite = useCallback((productId) => {
    const next = favorites.includes(productId)
      ? favorites.filter((id) => id !== productId)
      : [...favorites, productId];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("Failed to save favorites to localStorage", e);
    }
    cachedSnapshot = next;
    notify();
  }, [favorites]);

  const clearFavorites = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to clear favorites from localStorage", e);
    }
    cachedSnapshot = [];
    notify();
  }, []);

  return [favorites, toggleFavorite, clearFavorites];
}
