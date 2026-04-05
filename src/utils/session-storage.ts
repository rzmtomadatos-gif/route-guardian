/**
 * Session storage abstraction.
 * Web: localStorage with prefix.
 * Future native: swap implementation to Capacitor SecureStorage
 * without changing the interface.
 */

const PREFIX = 'vialroute_';

export const sessionStore = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      // silent — storage may be unavailable
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // silent
    }
  },
};
