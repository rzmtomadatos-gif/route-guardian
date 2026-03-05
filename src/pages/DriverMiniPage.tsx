import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCopilotDriver } from '@/hooks/useCopilotSession';
import { Loader2, WifiOff } from 'lucide-react';

const LS_KEY = 'driver-mini-seen-rev';

export default function DriverMiniPage() {
  const [params] = useSearchParams();
  const token = params.get('session');
  const { session, loading, error } = useCopilotDriver(token);

  const [seenRev, setSeenRev] = useState(() => {
    try { return parseInt(localStorage.getItem(`${LS_KEY}-${token}`) || '0', 10); } catch { return 0; }
  });

  const currentRev = session?.batch_number ?? 0;
  const hasNew = currentRev > seenRev && currentRev > 0;
  const hasBatch = !!session?.batch_url;
  const noPending = session && !session.batch_url && session.status !== 'waiting';

  // Vibrate on new revision
  const prevRevRef = useRef(0);
  useEffect(() => {
    if (currentRev > prevRevRef.current && prevRevRef.current > 0) {
      try { navigator.vibrate?.([300, 100, 300]); } catch {}
    }
    prevRevRef.current = currentRev;
  }, [currentRev]);

  const handlePress = () => {
    if (!session?.batch_url) return;
    // Persist seen revision
    setSeenRev(currentRev);
    try { localStorage.setItem(`${LS_KEY}-${token}`, String(currentRev)); } catch {}
    // Open Google Maps
    window.open(session.batch_url, '_blank');
  };

  // --- Minimal screens ---
  if (!token) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-2">
          <WifiOff className="w-10 h-10 text-neutral-500 mx-auto" />
          <p className="text-neutral-400 text-sm">Sin sesión</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-2">
          <WifiOff className="w-10 h-10 text-red-500 mx-auto" />
          <p className="text-neutral-400 text-sm">{error || 'Error'}</p>
        </div>
      </div>
    );
  }

  if (session.status === 'ended') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-neutral-500 text-lg font-bold">SESIÓN FINALIZADA</p>
      </div>
    );
  }

  // Determine button state
  let bgColor = 'bg-emerald-600'; // green = up to date
  let label = 'OK';

  if (!hasBatch && session.status === 'waiting') {
    bgColor = 'bg-neutral-700';
    label = 'ESPERANDO…';
  } else if (noPending) {
    bgColor = 'bg-neutral-600';
    label = 'SIN TRAMOS';
  } else if (hasNew) {
    bgColor = 'bg-amber-500'; // yellow = new route available
    label = 'ACTUALIZAR\nRUTA';
  }

  return (
    <div className="h-screen w-screen bg-black p-2 flex flex-col safe-area-top safe-area-bottom">
      <button
        onClick={handlePress}
        disabled={!hasBatch}
        className={`flex-1 rounded-2xl ${bgColor} transition-colors duration-300 flex items-center justify-center active:scale-95 disabled:opacity-50`}
      >
        <span className="text-white font-black text-4xl sm:text-5xl leading-tight whitespace-pre-line select-none">
          {label}
        </span>
      </button>
      {/* Debug rev counter - tap to show */}
      <p className="text-neutral-700 text-[8px] text-center mt-1 select-none">
        rev {currentRev}
      </p>
    </div>
  );
}
