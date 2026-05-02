# Contribuir a VialRoute

## Principios operativos

VialRoute es una herramienta de campo. La fiabilidad operativa real está
por encima de la estética. Antes de abrir una contribución:

1. ¿Romperá un flujo ya validado en campo? Si sí, justificar y minimizar.
2. ¿Es un cambio cosmético o funcional? Etiquetar con claridad.
3. ¿Toca lógica RST, navegación, persistencia o bloques de grabación?
   Adjuntar test que cubra el caso.

## Estilo y ramas

- Rama base: `main`.
- Commits semánticos cortos en español o inglés (consistencia con la rama).
- Una unidad lógica por PR. Evitar refactors mezclados con features.

## Requisitos para fusionar

Toda PR debe pasar localmente:

```bash
bun run lint
bunx tsc --noEmit
bun run test
```

Adicionalmente:

- Cambios de **dominio** (RST, tramos, bloques, navegación, persistencia):
  añadir test en `src/test/`.
- Cambios de **seguridad** (sanitización, schemas Zod, RLS, auth):
  añadir test y actualizar `SECURITY.md` si cambia el riesgo residual.
- Cambios de **esquema** de base de datos: usar migraciones Supabase, no
  editar `src/integrations/supabase/types.ts` (auto-generado).

## Checklist de PR

- [ ] Lint, typecheck y tests verdes.
- [ ] No se ha editado `src/integrations/supabase/client.ts` ni `types.ts`.
- [ ] No se ha tocado `supabase/config.toml` salvo bloques específicos
      por edge function.
- [ ] No hay `console.log` de depuración remanente.
- [ ] Textos visibles al usuario en español; nombres técnicos en inglés.
- [ ] Si la PR cambia el flujo RST: validado contra `mem://features/rst-mode`.
- [ ] Si la PR toca exportación: la hoja Excel abre sin errores en
      LibreOffice y MS Excel.

## Convenciones de código

- Componentes pequeños y enfocados.
- Lógica de negocio fuera de componentes (en `utils/` o hooks).
- Tokens semánticos del design system (no `bg-white`, `text-black` directos).
- Estados de tramo nunca derivados solo de UI; siempre desde
  `useRouteState`.

## Reportar bugs

Adjuntar:

- Versión instalada (visible en Ajustes → Acerca de).
- Pasos para reproducir.
- Estado del tramo / bloque afectado.
- Si es posible, export JSON de campaña anonimizado.
