

## Plan: RST Mode — Strategic Points, Correct End-of-Segment Logic, F7/F9 Protocol

### Problem Summary

The current end-of-segment reference logic is **inverted**: it triggers 300m/150m/30m references *before* reaching the segment end (using `remaining` distance). The correct RST protocol requires these references to fire *after* the vehicle has passed the geometric end of the segment. Additionally, the system needs strategic points (F9), F7 end-acquisition logic, and updated contiguous threshold.

### Changes

#### 1. Fix End-of-Segment References (Critical)
**File:** `src/hooks/useNavigationTracker.ts`

Current logic uses `remaining <= 300/150/30` which fires *before* the end. Must change to:
- Track `distancePastEnd` = distance the vehicle has traveled beyond the segment's last coordinate
- Fire `end_ref_30m` when `distancePastEnd >= 30`, `end_ref_150m` at `>=150`, `end_ref_300m` at `>=300`
- `ready_f5_end` triggers at `distancePastEnd >= 300` (operator should have pressed F5 by then)

Add new states and expand the state type:
- `past_end` — vehicle has passed the geometric end, awaiting references
- Keep existing `end_ref_30m/150m/300m` but with inverted meaning (now = past end)

Compute `distancePastEnd` as: if `progressPercent >= 100`, use `haversine(currentPosition, endPoint)`.

#### 2. Add Strategic Points (F9 — Exit Transport Mode)
**File:** `src/hooks/useNavigationTracker.ts`, `src/components/NavigationOverlay.tsx`

New states to add to `NavOperationalState`:
- `strategic_point` — vehicle approaching the strategic point (50m before segment start)
- `ready_f9` — at the strategic point, prompt F9 confirmation
- `ready_f7` — after segment end + refs, prompt F7 (end acquisition) if next segment >1500m

New fields in tracker state:
- `strategicPointDistance: number | null` — distance to strategic point
- `showF9Prompt: boolean`
- `showF7Prompt: boolean`

Logic:
- Strategic point is auto-calculated at `segmentStart - 50m` along the approach direction
- When vehicle reaches within 30m of strategic point → prompt "Confirmar F9 — Salir de modo transporte"
- After end refs complete and next segment >1500m → prompt F7
- After F7 confirmed and next segment >3500m → prompt F9 (enter transport mode)

#### 3. Update Contiguous Threshold
**File:** `src/hooks/useNavigationTracker.ts`

Change `contiguousThreshold` from `50` to `200` in `DEFAULT_THRESHOLDS`. When contiguous (<200m), single F5 closes current + opens next (already implemented). No end references needed for contiguous transitions.

#### 4. Post-End Protocol: F7 and F9
**File:** `src/hooks/useNavigationTracker.ts`, `src/components/NavigationOverlay.tsx`

After confirming F5 end (or after end_ref_300m for non-contiguous):
- If next segment is 200m–1500m away: no F7/F9 needed, just navigate
- If next segment is >1500m away: prompt F7 ("Confirmar F7 — Fin adquisición") after +30m and +150m refs; F5 at +300m
- If next segment is >3500m or no next segment: after F7, also prompt F9 ("Confirmar F9 — Modo transporte")

#### 5. New UI Elements in NavigationOverlay
**File:** `src/components/NavigationOverlay.tsx`

- Strategic point indicator in approach phase (before the 300m ref)
- F9 confirmation prompt (similar style to F5 prompt)
- F7 confirmation prompt after segment completion
- Update end reference markers to show they are *past* the end ("+30m", "+150m", "+300m" labels)

#### 6. F5/F7/F9 Event Types
**File:** `src/types/route.ts`

Extend `F5Event.eventType` to include: `'inicio' | 'pk' | 'fin' | 'f7_fin_adquisicion' | 'f9_modo_transporte'`

#### 7. Sound Effects
**File:** `src/utils/sounds.ts`

Add `playF7Sound()` and `playF9Sound()` — distinct tones for F7 (end acquisition) and F9 (transport mode) confirmations.

#### 8. Verify Duplicate Button Removal
**File:** `src/components/MapControlPanel.tsx`

Confirm "Enviar a conductor" and "Abrir con Google Maps" buttons are removed (may already be done from previous iteration).

### Files to Modify
1. `src/types/route.ts` — extend F5Event eventType
2. `src/hooks/useNavigationTracker.ts` — fix end refs, add strategic points, F7/F9 states, update contiguous threshold
3. `src/components/NavigationOverlay.tsx` — new prompts for F9/F7, fix end ref labels, strategic point UI
4. `src/utils/sounds.ts` — add F7/F9 sounds
5. `src/pages/MapPage.tsx` — wire F7/F9 handlers and sounds

