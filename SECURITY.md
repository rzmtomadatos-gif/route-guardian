# Política de seguridad

## Versiones soportadas

Solo se mantiene la rama `main`. Los parches de seguridad se aplican sobre
la última versión publicada.

## Reportar una vulnerabilidad

- Contacto privado al equipo de mantenimiento (no abrir issue público).
- Tiempo objetivo de respuesta: 5 días laborables.
- Tiempo objetivo de remediación: 30 días para severidad alta/crítica.

## Modelo de acceso

- **Local-first**: cada operador trabaja sobre una base SQLite WASM en su
  dispositivo. La campaña es portable mediante export/import JSON.
- **Auth**: Lovable Cloud con email/password. Sin signups anónimos.
- **RBAC**: roles `admin`, `operator`, `gabinete` en tabla `user_roles`
  separada de `profiles`. Verificación vía función SECURITY DEFINER
  `has_role()` para evitar recursión en RLS.
- **RLS** activa en todas las tablas. El acceso al token de copiloto está
  restringido vía `REVOKE SELECT` adicional.

## Validación de entradas

- **KML**: descripciones HTML pasan por DOMPurify (`sanitizeHtml`).
- **Campañas JSON**: validación con Zod en modo `.strict()`. Límites:
  100 MB de tamaño, 50.000 segmentos. Estructura inválida → rechazo
  inmediato. HTML inseguro u huérfanos → corrección silenciosa registrada.
- **Imports KML**: máximo 200 MB. Cross-check de `optimizedOrder` contra
  IDs reales.
- **Eventos auditables**: SQL parametrizado en event log para evitar
  inyección.

## Dependencias

- **`xlsx` retirada** (CVE-2023-30533 Prototype Pollution + CVE-2024-22363
  ReDoS, sin versión parcheada en npm). Migrado a `exceljs ^4.4.0` con
  dynamic import.
- **`vite ^5.4.20+`**: corrige vulnerabilidades del dev/preview server
  reportadas hasta 5.4.19.
- Recomendado: activar Dependabot / `npm audit` semanal.

## Riesgos residuales aceptados

- El modo copiloto (`/driver-mini`) usa Supabase Realtime con token de
  sesión efímero. Caducidad gestionada vía RLS y rotación.
- El service worker cachea tiles offline (~250 MB max). No cachea HTML
  con estrategia stale-while-revalidate; `version.json` siempre se pide
  con `cache: no-store`.

## Reglas de publicación responsable

- No publicar payloads explotables hasta que el parche esté desplegado.
- No exponer datos reales de campañas en issues públicos.
