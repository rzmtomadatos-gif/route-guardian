# VialRoute Companion

Aplicación de apoyo operativo para campañas de auscultación vial. Guía al
vehículo entre tramos, asiste al operador durante la adquisición y mantiene
la lógica real de trabajo en campo (RST y Garmin).

## Stack

- Vite 5 + React 18 + TypeScript 5
- Tailwind + shadcn/ui
- Lovable Cloud (Supabase) — auth, RLS, edge functions
- Google Maps (provider primario) + Leaflet/PMTiles (fallback offline)
- SQLite WASM (sql.js) en navegador para event log y persistencia local
- exceljs para exportación de hojas de ruta
- DOMPurify + Zod para sanitización y validación estricta

## Conceptos clave

- **Tramo**: segmento de vía definido en KML que debe recorrerse y grabarse.
- **Bloque de grabación**: hasta 9 tramos por vídeo.
- **id_unico** (`companySegmentId`): identificador interno del tramo.
- **Punto estratégico**: punto calculado al menos 50 m antes del inicio del
  tramo, para salir de modo transporte.
- **Estados**: `pendiente`, `en_progreso`, `completado`, `posible_repetir`,
  con flags `nonRecordable`, `needsRepeat`, `repeatRequested`.

## Modos de adquisición

- **RST**: lógica completa con referencias a 300/150/30 m antes del inicio y
  +30/+150/+300 m tras el final. Confirmaciones por F5/F7/F9.
- **No RST (Garmin)**: sin avisos RST; cronómetro sincronizado para vídeo.

## Scripts

```bash
bun install
bun run dev        # entorno de desarrollo
bun run build      # build de producción (genera version.json)
bun run lint       # ESLint
bun run test       # vitest run
bun run preview    # preview local del build
```

## Estructura

- `src/components/` — UI (mapa, paneles, diálogos)
- `src/pages/` — rutas (`/map`, `/segments`, `/gabinete`, `/settings`, …)
- `src/hooks/` — estado (`useRouteState`, `useGeolocation`, `usePwaUpdate`, …)
- `src/utils/` — lógica de dominio
  - `persistence/` — SQLite WASM, event log, schemas Zod
  - `gabinete/` — consolidación de correcciones, derivación de intentos
  - `excel-export.ts`, `excel-export-v2.ts` — exportadores
- `src/integrations/supabase/` — cliente y tipos generados (no editar)
- `supabase/` — config, migraciones y edge functions

## Seguridad

Ver [SECURITY.md](./SECURITY.md). Resumen:

- Sanitización HTML/KML con DOMPurify.
- Validación estricta de campañas con Zod (`.strict()`), límite 100 MB, 50k
  segmentos.
- RLS en todas las tablas, RBAC por `app_role` (admin/operator/gabinete).
- `xlsx` retirado por vulnerabilidades sin parche; uso exclusivo de
  `exceljs` con dynamic import.

## Contribuir

Ver [CONTRIBUTING.md](./CONTRIBUTING.md).

## Despliegue

El proyecto se publica desde Lovable. PWA solo activa en build de
producción. Las actualizaciones se aplican manualmente desde
**Ajustes → Acerca de → Actualizar ahora** sin perder la campaña ni el
event log local.
