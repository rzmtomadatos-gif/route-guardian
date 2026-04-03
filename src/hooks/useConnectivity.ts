import { useState, useEffect, useCallback } from 'react';

/**
 * Reactive hook for navigator.onLine status.
 * Returns { isOnline, wasOffline } where wasOffline indicates
 * we came back from an offline period (useful for prompting map switch).
 */
export function useConnectivity() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      setWasOffline(true); // We just came back
    };
    const goOffline = () => {
      setIsOnline(false);
      setWasOffline(false);
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /** Acknowledge recovery — clears wasOffline flag */
  const ackRecovery = useCallback(() => setWasOffline(false), []);

  return { isOnline, wasOffline, ackRecovery };
}
