import { useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Trash2, Info, Key, Check, Eye, EyeOff, X, Loader2, CheckCircle, XCircle, User, Car, Cloud, Hash, Download, Upload, FileOutput, LogOut, Shield } from 'lucide-react';
import { OfflineMapsManager } from '@/components/OfflineMapsManager';
import { useAuth } from '@/hooks/useAuth';
import { LogoutDialog } from '@/components/LogoutDialog';
import { getGoogleMapsApiKey, setGoogleMapsApiKey } from '@/utils/google-directions';
import { ProjectCodeDialog } from '@/components/ProjectCodeDialog';
import { exportCampaign, importCampaign } from '@/utils/persistence';
import { routeToKml, downloadKml } from '@/utils/kml-export';
import { toast } from 'sonner';
import type { Route, AppState } from '@/types/route';

interface Props {
  onClear: () => void;
  hasRoute: boolean;
  route: Route | null;
  state: AppState;
  isDirty?: boolean;
  onMarkClean?: () => void;
  onUpdateRouteContext: (updates: { operator?: string; vehicle?: string; weather?: string }) => void;
  onApplyRetroactiveIds: (code: string, projectName: string) => void;
  onRestoreState: (state: AppState) => void;
}

export default function SettingsPage({ onClear, hasRoute, route, state, isDirty, onMarkClean, onUpdateRouteContext, onApplyRetroactiveIds, onRestoreState }: Props) {
  const [apiKey, setApiKey] = useState(getGoogleMapsApiKey());
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [startHidden, setStartHidden] = useState(() => {
    try { return localStorage.getItem('vialroute_start_hidden') === 'true'; } catch { return false; }
  });
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const handleExportCampaign = async () => {
    try {
      await exportCampaign(state);
      toast.success('Campaña exportada correctamente.');
    } catch (e: any) {
      toast.error(`Error exportando campaña: ${e.message || e}`);
    }
  };

  const handleImportCampaign = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importCampaign(file);
      onRestoreState(imported);
      toast.success(`Campaña importada: ${imported.route?.name || 'sin nombre'}`);
    } catch (err: any) {
      toast.error(err.message || 'Error importando campaña');
    }
    // Reset input
    if (importRef.current) importRef.current.value = '';
  };

  const missingIdCount = useMemo(() => {
    if (!route) return 0;
    return route.segments.filter((s) => !s.companySegmentId).length;
  }, [route]);

  const handleSaveKey = () => {
    setGoogleMapsApiKey(apiKey);
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearKey = () => {
    setApiKey('');
    setGoogleMapsApiKey('');
    setTestResult(null);
  };

  const handleTestKey = async () => {
    if (!apiKey) return;
    setTesting(true);
    setTestResult(null);
    setGoogleMapsApiKey(apiKey);

    try {
      const existing = document.querySelector('script[src*="maps.googleapis.com"]');
      if (existing) existing.remove();

      const result = await new Promise<'ok' | 'error'>((resolve) => {
        (window as any).gm_authFailure = () => resolve('error');

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=routes`;
        script.async = true;
        script.onload = () => {
          setTimeout(() => {
            const errContainer = document.querySelector('.gm-err-container');
            if (errContainer) resolve('error');
            else if ((window as any).google?.maps) resolve('ok');
            else resolve('error');
          }, 1000);
        };
        script.onerror = () => resolve('error');
        document.head.appendChild(script);
        setTimeout(() => resolve('error'), 8000);
      });

      setTestResult(result);
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const handleGenerateIds = () => {
    if (!route) return;
    if (route.projectCode) {
      // Already has project code, apply directly
      onApplyRetroactiveIds(route.projectCode, route.projectName || route.projectCode);
      toast.success(`IDs únicos generados correctamente para ${missingIdCount} tramos.`);
    } else {
      // Need to ask for project code
      setShowCodeDialog(true);
    }
  };

  const handleCodeConfirm = (code: string, name: string) => {
    setShowCodeDialog(false);
    const count = missingIdCount;
    onApplyRetroactiveIds(code, name);
    toast.success(`IDs únicos generados correctamente para ${count} tramos.`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 bg-card border-b border-border">
        <h2 className="text-lg font-bold text-foreground">Configuración</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Retroactive IDs */}
        {route && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Hash className="w-4 h-4" />
              <span className="text-sm font-medium">Identificadores de tramo</span>
            </div>
            <div className="bg-card rounded-xl p-4 border border-border space-y-3">
              {missingIdCount > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Hay <span className="text-foreground font-medium">{missingIdCount}</span> tramos sin identificador único de empresa.
                  </p>
                  <Button
                    onClick={handleGenerateIds}
                    className="w-full"
                    size="sm"
                  >
                    <Hash className="w-4 h-4 mr-2" />
                    GENERAR ID_EMPRESA
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  IDs únicos ya generados
                </div>
              )}
            </div>
          </div>
        )}

        {/* Google Maps API Key */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Key className="w-4 h-4" />
            <span className="text-sm font-medium">Google Maps API</span>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border space-y-3">
            <p className="text-xs text-muted-foreground">
              API Key para optimización de rutas con Google Directions. Sin clave se usa el algoritmo local.
            </p>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                placeholder="AIza..."
                className="bg-secondary border-border text-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
                testResult === 'ok' 
                  ? 'bg-green-500/10 text-green-400' 
                  : 'bg-destructive/10 text-destructive'
              }`}>
                {testResult === 'ok' 
                  ? <><CheckCircle className="w-4 h-4" /> API Key válida — Google Maps activo</>
                  : <><XCircle className="w-4 h-4" /> API Key inválida o sin permisos</>
                }
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleSaveKey}
                disabled={!apiKey}
                className="flex-1 driving-button bg-primary text-primary-foreground"
                size="sm"
              >
                {saved ? <Check className="w-4 h-4 mr-1" /> : <Key className="w-4 h-4 mr-1" />}
                {saved ? 'Guardada' : 'Guardar'}
              </Button>
              <Button
                onClick={handleTestKey}
                disabled={!apiKey || testing}
                variant="outline"
                size="sm"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Probar'}
              </Button>
              <Button
                onClick={handleClearKey}
                disabled={!apiKey}
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Layers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Eye className="w-4 h-4" />
            <span className="text-sm font-medium">Capas</span>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Iniciar con capas ocultas</p>
                <p className="text-xs text-muted-foreground">Al cargar ruta nueva, todas las capas empiezan ocultas.</p>
              </div>
              <Switch
                checked={startHidden}
                onCheckedChange={(v) => {
                  setStartHidden(v);
                  try { localStorage.setItem('vialroute_start_hidden', v ? 'true' : 'false'); } catch {}
                }}
              />
            </div>
          </div>
        </div>

        {/* Project context */}
        {route && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">Contexto del proyecto</span>
            </div>
            <div className="bg-card rounded-xl p-4 border border-border space-y-3">
              {route.projectCode && (
                <p className="text-xs text-muted-foreground">
                  Proyecto: <span className="text-foreground font-medium">{route.projectCode}</span>
                  {route.projectName && ` — ${route.projectName}`}
                </p>
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <Input
                    placeholder="Operador"
                    value={route.operator || ''}
                    onChange={(e) => onUpdateRouteContext({ operator: e.target.value })}
                    className="h-8 text-sm bg-secondary border-border"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Car className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <Input
                    placeholder="Vehículo"
                    value={route.vehicle || ''}
                    onChange={(e) => onUpdateRouteContext({ vehicle: e.target.value })}
                    className="h-8 text-sm bg-secondary border-border"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Cloud className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <Input
                    placeholder="Climatología"
                    value={route.weather || ''}
                    onChange={(e) => onUpdateRouteContext({ weather: e.target.value })}
                    className="h-8 text-sm bg-secondary border-border"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Offline Maps */}
        <OfflineMapsManager segments={route?.segments} />

        {/* App info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="w-4 h-4" />
            <span className="text-sm font-medium">Acerca de</span>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border space-y-2">
            <p className="text-sm text-foreground font-medium">VialRoute</p>
            <p className="text-xs text-muted-foreground">
              Aplicación de auscultación vial para optimización y guía de rutas de grabación.
            </p>
            <p className="text-xs text-muted-foreground">Versión 1.1.0</p>
          </div>
        </div>

        {/* Export KML */}
        {route && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileOutput className="w-4 h-4" />
              <span className="text-sm font-medium">Exportar ruta</span>
            </div>
            <div className="bg-card rounded-xl p-4 border border-border space-y-3">
              <p className="text-xs text-muted-foreground">
                Descarga la ruta actual como archivo KML. El trabajo se guarda automáticamente en el dispositivo.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    const kml = routeToKml(route);
                    downloadKml(kml, route.fileName || `${route.name}.kml`);
                    onMarkClean?.();
                    toast.success(`${route.fileName || route.name} exportado correctamente.`);
                  }}
                  className="flex-1"
                  size="sm"
                >
                  <FileOutput className="w-4 h-4 mr-2" />
                  Exportar KML
                </Button>
                <Button
                  onClick={() => {
                    const newName = prompt('Nombre del archivo:', route.name + '_copia');
                    if (!newName) return;
                    const kml = routeToKml(route);
                    downloadKml(kml, `${newName}.kml`);
                    toast.success(`${newName}.kml exportado correctamente.`);
                  }}
                  variant="outline"
                  className="flex-1"
                  size="sm"
                >
                  Exportar como…
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Campaign export/import */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-muted-foreground">Campaña</span>
          <div className="bg-card rounded-xl p-4 border border-border space-y-3">
            <p className="text-xs text-muted-foreground">
              Exporta la campaña completa (estado + log de eventos) como JSON para transferir a otro dispositivo o como respaldo.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleExportCampaign}
                disabled={!hasRoute}
                className="flex-1"
                size="sm"
              >
                <Download className="w-4 h-4 mr-2" />
                Exportar campaña
              </Button>
              <Button
                onClick={() => importRef.current?.click()}
                variant="outline"
                className="flex-1"
                size="sm"
              >
                <Upload className="w-4 h-4 mr-2" />
                Importar campaña
              </Button>
              <input
                ref={importRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportCampaign}
              />
            </div>
          </div>
        </div>

        {/* Data */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-muted-foreground">Datos</span>
          <div className="bg-card rounded-xl p-4 border border-border space-y-3">
            <p className="text-xs text-muted-foreground">
              Los datos se almacenan localmente en este dispositivo. Borrar datos eliminará la ruta actual y todas las incidencias registradas.
            </p>
            <Button
              onClick={onClear}
              disabled={!hasRoute}
              variant="outline"
              className="w-full driving-button border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Borrar todos los datos
            </Button>
          </div>
        </div>
      </div>

      {/* Project code dialog for retroactive IDs */}
      <ProjectCodeDialog
        open={showCodeDialog}
        onConfirm={handleCodeConfirm}
      />
    </div>
  );
}
