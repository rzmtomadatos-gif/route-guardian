import { useState, useEffect, useCallback } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthGuard } from "@/components/AuthGuard";
import { useRouteState } from "@/hooks/useRouteState";
import { migrateAndLoad, didStartDegraded } from "@/utils/persistence";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useCopilotOperator } from "@/hooks/useCopilotSession";
import UploadPage from "@/pages/Index";
import MapPage from "@/pages/MapPage";
import SegmentsPage from "@/pages/SegmentsPage";
import SettingsPage from "@/pages/SettingsPage";
import DriverPage from "@/pages/DriverPage";
import DriverMiniPage from "@/pages/DriverMiniPage";
import AuthPage from "@/pages/AuthPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NotFound from "./pages/NotFound";
import { RecoveryDialog } from "@/components/RecoveryDialog";

const queryClient = new QueryClient();

type DbStatus = 'starting' | 'ready' | 'degraded';

function AppRoutes() {
  const routeState = useRouteState();
  const [dbStatus, setDbStatus] = useState<DbStatus>('starting');
  const location = useLocation();

  // Persistent GPS & Copilot — survive tab switches
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const geo = useGeolocation(gpsEnabled);
  const copilot = useCopilotOperator();

  // Recovery dialog state
  const [recoveryInfo, setRecoveryInfo] = useState<{ count: number; hadNav: boolean } | null>(null);

  // Single async load from SQLite on mount — NO localStorage fallback
  useEffect(() => {
    migrateAndLoad()
      .then((restored) => {
        // Detect if recovery is needed before restoreState sanitizes
        const inProgressSegs = restored.route?.segments.filter(s => s.status === 'en_progreso') ?? [];
        const hadNav = restored.navigationActive;
        routeState.restoreState(restored);
        setDbStatus(didStartDegraded() ? 'degraded' : 'ready');
        if (inProgressSegs.length > 0) {
          setRecoveryInfo({ count: inProgressSegs.length, hadNav });
        }
      })
      .catch((e) => {
        console.error('Persistence restoration failed:', e);
        setDbStatus('degraded');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    state, isDirty, markClean, setRoute, startNavigation,
    prepareStopNavigation, confirmStopNavigation,
    confirmStartSegment, completeSegment, addIncident, reoptimize,
    resetSegment, clearRoute, setActiveSegment, setBase, updateSegment,
    updateIncident, deleteIncident, addLayer, renameLayer, deleteLayer,
    moveSegmentToLayer, mergeSegments, addSegment, deleteSegment,
    bulkDeleteSegments, bulkMoveToLayer, bulkSetColor, duplicateSegments,
    reorderSegment, reverseSegment, simplifySegments, setRstMode,
    setRstGroupSize, markPosibleRepetir, repeatSegment, finalizeTrack,
    skipSegment, closeBlockEndPrompt, changeWorkDay, updateRouteContext,
    applyRetroactiveIds, setAcquisitionMode, applyRouteOrder, restoreState,
    cancelStartSegment, cancelAllInProgress,
  } = routeState;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [startWithLayersHidden] = useState(() => {
    try { return localStorage.getItem('vialroute_start_hidden') === 'true'; } catch { return false; }
  });

  // Auto-hide all layers when a new route is loaded
  const prevRouteId = useState<string | null>(null);
  if (state.route && state.route.id !== prevRouteId[0]) {
    prevRouteId[1](state.route.id);
    if (startWithLayersHidden && state.route.availableLayers) {
      const allLayers = new Set<string>();
      state.route.segments.forEach((s) => { if (s.layer) allLayers.add(s.layer); });
      if (allLayers.size > 0) setHiddenLayers(allLayers);
    }
  }

  const isMapRoute = location.pathname === '/map';

  const handleRecoveryRestore = useCallback(() => setRecoveryInfo(null), []);
  const handleRecoveryCancelSegments = useCallback(() => {
    cancelAllInProgress('recovery_cancel');
    setRecoveryInfo(null);
  }, [cancelAllInProgress]);

  return (
    <>
    <RecoveryDialog
      open={recoveryInfo !== null}
      inProgressCount={recoveryInfo?.count ?? 0}
      hadNavigation={recoveryInfo?.hadNav ?? false}
      onRestore={handleRecoveryRestore}
      onCancelSegments={handleRecoveryCancelSegments}
    />
    <AppLayout
      selectedCount={selectedIds.size}
      onClearSelection={() => setSelectedIds(new Set())}
    >
      {dbStatus === 'starting' && (
        <div className="flex items-center gap-2 justify-center py-2 bg-muted/50 border-b border-border">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground">Iniciando persistencia...</span>
        </div>
      )}
      {dbStatus === 'degraded' && (
        <div className="bg-destructive/10 text-destructive text-xs text-center py-1.5 px-3 border-b border-destructive/20">
          ⚠ Modo contingencia: persistencia no disponible. Los cambios no se guardarán hasta reconectar.
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <UploadPage
              onRouteLoaded={setRoute}
              hasRoute={!!state.route}
              isDirty={isDirty}
              route={state.route}
              onMarkClean={markClean}
            />
          }
        />
        <Route
          path="/segments"
          element={
            <SegmentsPage
              state={state}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              onResetSegment={resetSegment}
              onCompleteSegment={completeSegment}
              onUpdateSegment={updateSegment}
              onUpdateIncident={updateIncident}
              onDeleteIncident={deleteIncident}
              onSetActiveSegment={setActiveSegment}
              onRenameLayer={renameLayer}
              onDeleteLayer={deleteLayer}
              onMoveToLayer={moveSegmentToLayer}
              onMergeSegments={mergeSegments}
              onAddLayer={addLayer}
              onDeleteSegment={deleteSegment}
              onBulkDelete={bulkDeleteSegments}
              onBulkMove={bulkMoveToLayer}
              onBulkColor={bulkSetColor}
              onDuplicate={duplicateSegments}
              onReorder={reorderSegment}
              onReverseSegment={reverseSegment}
              onSimplify={simplifySegments}
              hiddenLayers={hiddenLayers}
              onHiddenLayersChange={setHiddenLayers}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsPage
              onClear={clearRoute}
              hasRoute={!!state.route}
              route={state.route}
              state={state}
              isDirty={isDirty}
              onMarkClean={markClean}
              onUpdateRouteContext={updateRouteContext}
              onApplyRetroactiveIds={applyRetroactiveIds}
              onRestoreState={restoreState}
            />
          }
        />
        <Route path="*" element={isMapRoute ? null : <NotFound />} />
      </Routes>
      {/* Persistent MapPage — never unmounted, hidden via CSS when not on /map */}
      <div style={{ display: isMapRoute ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <MapPage
          state={state}
          onStartNavigation={startNavigation}
          onPrepareStopNavigation={prepareStopNavigation}
          onConfirmStopNavigation={confirmStopNavigation}
          onConfirmStart={confirmStartSegment}
          onComplete={completeSegment}
          onResetSegment={resetSegment}
          onAddIncident={addIncident}
          onReoptimize={reoptimize}
          onSetActiveSegment={setActiveSegment}
          onSetBase={setBase}
          onAddSegment={addSegment}
          onMergeSegments={mergeSegments}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          hiddenLayers={hiddenLayers}
          onSetRstMode={setRstMode}
          onSetRstGroupSize={setRstGroupSize}
          onRepeatSegment={repeatSegment}
          onFinalizeTrack={finalizeTrack}
          onSkipSegment={skipSegment}
          onCancelStartSegment={cancelStartSegment}
          onCancelAllInProgress={cancelAllInProgress}
          onCloseBlockEndPrompt={closeBlockEndPrompt}
          onChangeWorkDay={changeWorkDay}
          onReverseSegment={reverseSegment}
          onReorderSegment={reorderSegment}
          onSetAcquisitionMode={setAcquisitionMode}
          onApplyRouteOrder={applyRouteOrder}
          geo={geo}
          gpsEnabled={gpsEnabled}
          setGpsEnabled={setGpsEnabled}
          copilot={copilot}
          visible={isMapRoute}
        />
      </div>
    </AppLayout>
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public routes — no auth required */}
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/driver" element={<DriverPage />} />
          <Route path="/driver-mini" element={<DriverMiniPage />} />
          {/* Protected routes */}
          <Route
            path="/*"
            element={
              <AuthGuard>
                <AppRoutes />
              </AuthGuard>
            }
          />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
