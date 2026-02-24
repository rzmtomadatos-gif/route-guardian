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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
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
  } = useRouteState();

  return (
    <AppLayout
      route={state.route}
      isDirty={isDirty}
      onMarkClean={markClean}
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
            />
          }
        />
        <Route
          path="/segments"
          element={
            <SegmentsPage
              state={state}
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
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsPage
              onClear={clearRoute}
              hasRoute={!!state.route}
            />
          }
        />
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
