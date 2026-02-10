import { useState } from 'react';
import { MapPin, LocateFixed, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getGoogleMapsApiKey } from '@/utils/google-directions';
import type { LatLng, BaseLocation } from '@/types/route';

interface Props {
  currentBase: BaseLocation | null;
  currentPosition: LatLng | null;
  onSetBase: (base: BaseLocation) => void;
  children: React.ReactNode;
}

export function BaseLocationDialog({ currentBase, currentPosition, onSetBase, children }: Props) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUseGps = () => {
    if (!currentPosition) {
      setError('Activa el GPS primero para usar tu ubicación');
      return;
    }
    onSetBase({ position: currentPosition, label: 'Ubicación GPS' });
    setOpen(false);
  };

  const handleSearchAddress = async () => {
    if (!address.trim()) return;
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      setError('Configura la API Key de Google Maps en Ajustes');
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`
      );
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const { lat, lng } = data.results[0].geometry.location;
        const label = data.results[0].formatted_address || address.trim();
        onSetBase({ position: { lat, lng }, label });
        setOpen(false);
        setAddress('');
      } else {
        setError('No se encontró la dirección');
      }
    } catch {
      setError('Error al buscar la dirección');
    } finally {
      setSearching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Base de trabajo</DialogTitle>
        </DialogHeader>

        {currentBase && (
          <div className="bg-secondary/50 rounded-lg p-3 text-sm">
            <p className="text-muted-foreground text-xs">Base actual</p>
            <p className="text-foreground font-medium truncate">{currentBase.label}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {currentBase.position.lat.toFixed(5)}, {currentBase.position.lng.toFixed(5)}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Button
            onClick={handleUseGps}
            variant="outline"
            className="w-full min-h-[48px] border-border text-foreground"
          >
            <LocateFixed className="w-4 h-4 mr-2" />
            Usar ubicación GPS actual
          </Button>

          <div className="flex gap-2">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Buscar dirección..."
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleSearchAddress()}
              maxLength={200}
            />
            <Button
              onClick={handleSearchAddress}
              disabled={searching || !address.trim()}
              className="min-h-[40px] bg-primary text-primary-foreground"
            >
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
