

## Actualizar documentación VialRoute — Resumen Ejecutivo y Resumen de Seguridad

### Estado actual del proyecto (listado completo)

```text
TERMINADO (implementado y verificado)
──────────────────────────────────────
✔ Service Worker / PWA (vite-plugin-pwa + Workbox)
  - Precache de sql-wasm.wasm (10 MB limit)
  - Runtime caching de tiles CartoDB (7 días, 2000 entries)
  - Precache de JS/CSS/HTML/iconos
  - manifest.json propio

✔ Inicialización resistente (withTimeout en initDatabase)
  - Timeout 8s para carga WASM
  - Modo degradado con banner "Modo contingencia"
  - degradedMode=true si falla WASM

✔ Persistencia SQL.js + IndexedDB
  - Esquema versionado (app_state, event_log)
  - Export/Import de campaña (JSON)
  - Migración localStorage → IndexedDB completada

✔ Seguridad sesiones Copiloto (4 migraciones aplicadas)
  - RPCs SECURITY DEFINER: create, update, delete, read_by_token
  - Column-level REVOKE SELECT en columna token (anon + authenticated)
  - CHECK constraints en status y batch_url
  - Limpieza automática sesiones > 7 días
  - Tokens UUID v4 (gen_random_uuid)

✔ Cliente Copiloto resiliente
  - useCopilotSession.ts preserva token en memoria
  - Merge Realtime (token: prev.token) en operador y conductor
  - Compatible con payload sin token

✔ Linter de base de datos limpio (0 hallazgos)

✔ Escaneo de seguridad limpio
  - 2 hallazgos informativos (ignorados con justificación)
  - 0 errores, 0 warnings activos

✔ Mapas Google + fallback Leaflet
  - Conmutación automática si falta API key o red

EN PROCESO / PARCIAL
──────────────────────────────────────
◐ Restricción API Key Google Maps
  - Key en frontend (necesario), pero falta restricción
    por dominio/referrer en consola Google (acción externa)

◐ Sanitización KML/HTML
  - Parser KML funciona con DOMParser
  - Falta sanitizer robusto (DOMPurify) para campos
    <description> con HTML arbitrario

◐ Validación JSON import
  - JSON.parse con try/catch
  - Falta validación exhaustiva (JSON Schema)

◐ CSP (Content Security Policy)
  - No configurada en headers de despliegue

PENDIENTE (no iniciado)
──────────────────────────────────────
○ Migración a Capacitor + SQLite nativo (Fase 3+)
○ Grabación GPS cada 10 m ("Cuenta Pasos")
○ Tests de seguridad automatizados (DAST/fuzzing KML)
○ npm audit / SCA integrado en pipeline
○ Reglas RST/Garmin completadas (Fase 2)
○ UI para crear proyecto offline sin KML previo
○ PIN opcional para conductor en copiloto
○ Mapas offline con PMTiles (descarga en background)
```

### Cambios a aplicar en cada documento

**Resumen Ejecutivo (Resumen_ejecutivo04-04_v2.docx)**

1. **Sección 2 (Hallazgos)**: Actualizar párrafo RLS/Supabase con detalle de 4 migraciones, RPCs SECURITY DEFINER, column-level grants, y verificación con `has_column_privilege`.

2. **Sección 3 (Causas fallo offline)**:
   - Punto 1 (WASM no cacheado): marcar RESUELTO — PWA precachea sql-wasm.wasm.
   - Punto 2 (Ausencia de SW): marcar RESUELTO — vite-plugin-pwa activo.
   - Punto 5 (RLS mal configuradas): marcar RESUELTO.

3. **Sección 4 (Mejoras P0)**:
   - Precache SW: IMPLEMENTADO
   - Inicialización resistente: IMPLEMENTADO
   - Swap offline/online mapa: PARCIAL (tiles Carto cacheados, Google Maps fallback funciona)

4. **Sección 7 (Criterios aceptación)**: Marcar cumplidos los puntos verificados.

5. **Nueva sección**: "Seguridad de sesiones Copiloto" con la arquitectura actual.

6. **Sección 10 (Fases)**: Actualizar timeline con estado real.

**Resumen de Seguridad (Resumen_seguridad_v2.docx)**

1. **Sección Autenticación/Autorización (p.8)**: Añadir que tokens son UUID v4, column-level REVOKE aplicado, acceso solo vía RPC.

2. **Sección Gestión de Sesiones (p.8)**: Eliminar referencia a políticas INSERT/UPDATE/DELETE públicas — ya no existen.

3. **Tabla de impacto (pp.12-14)**: Rebajar severidad residual de "Token copiloto predecible/expuesto" y "RLS ausente" a Bajo/Mitigado.

4. **Checklist de Remediación (pp.16-17)**: Actualizar estados:
   - Configurar RLS en Supabase: `[✓]`
   - Mejorar autenticación copiloto: `[✓]`
   - Restringir API Keys: `[parcial]`
   - Sanitizar KML/HTML: `[ ]`
   - Validar JSON import: `[ ]`
   - Configurar CSP: `[ ]`
   - Tests de seguridad: `[ ]`

5. **Nueva sección**: "Mitigaciones implementadas (abril 2026)" — resumen consolidado de las 4 migraciones y cambios de cliente.

### Implementación

1. Generar ambos DOCX con Node.js (`docx` library) basados en el contenido original actualizado
2. Guardar como:
   - `/mnt/documents/Resumen_ejecutivo04-04_v2.docx`
   - `/mnt/documents/Resumen_seguridad_v2.docx`
3. QA visual de ambos documentos (convertir a imágenes y verificar)

### Archivos afectados
- **Crear**: `/mnt/documents/Resumen_ejecutivo04-04_v2.docx`
- **Crear**: `/mnt/documents/Resumen_seguridad_v2.docx`
- Sin cambios en código fuente

