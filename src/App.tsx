import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useRouteState } from "@/hooks/useRouteState";
import UploadPage from "@/pages/Index";
import MapPage from "@/pages/MapPage";
import SegmentsPage from "@/pages/SegmentsPage";
import SettingsPage from "@/pages/SettingsPage";
import DriverPage from "@/pages/DriverPage";
import DriverMiniPage from "@/pages/DriverMiniPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const routeState = useRouteState();
  const {
    state,
    isDirty,
    markClean,
    setRoute,
    startNavigation,
    stopNavigation,
    confirmStartSegment,
    completeSegment,
    addIncident,
    reoptimize,
    resetSegment,
    clearRoute,
    setActiveSegment,
    setBase,
    updateSegment,
    updateIncident,
    deleteIncident,
    addLayer,
    renameLayer,
    deleteLayer,
    moveSegmentToLayer,
    mergeSegments,
    addSegment,
    deleteSegment,
    bulkDeleteSegments,
    bulkMoveToLayer,
    bulkSetColor,
    duplicateSegments,
    reorderSegment,
    reverseSegment,
    simplifySegments,
    setRstMode,
    setRstGroupSize,
    markPosibleRepetir,
    repeatSegment,
    finalizeTrack,
    skipSegment,
    closeBlockEndPrompt,
    setWorkDay,
    updateRouteContext,
    applyRetroactiveIds,
    setAcquisitionMode,
    applyRouteOrder,
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

  return (
    <AppLayout
      route={state.route}
      isDirty={isDirty}
      onMarkClean={markClean}
      selectedCount={selectedIds.size}
      onClearSelection={() => setSelectedIds(new Set())}
    >
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
          path="/map"
          element={
            <MapPage
              state={state}
              onStartNavigation={startNavigation}
              onStopNavigation={stopNavigation}
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
              onCloseBlockEndPrompt={closeBlockEndPrompt}
              onSetWorkDay={setWorkDay}
              onReverseSegment={reverseSegment}
              onSetAcquisitionMode={setAcquisitionMode}
              onApplyRouteOrder={applyRouteOrder}
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
              onUpdateRouteContext={updateRouteContext}
              onApplyRetroactiveIds={applyRetroactiveIds}
            />
          }
        />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/driver-mini" element={<DriverMiniPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
