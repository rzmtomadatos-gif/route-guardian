

# Bug: Google Maps no se restaura al volver online

## Causa raíz

En `GoogleMapDisplay.tsx`, líneas 196-210, la lógica de restauración tiene un fallo crítico:

```typescript
useEffect(() => {
  if (!isOnline && !fallbackToLeaflet) {
    if (mapReady || hadGoogleRef.current) {
      hadGoogleRef.current = true;
    }
    setOfflineSwitch(true);                    // ← OK: cambia a Leaflet
  } else if (isOnline && wasOffline && offlineSwitch) {
    if (hadGoogleRef.current && !fallbackToLeaflet) {
      setOfflineSwitch(false);                 // ← PROBLEMA
    }
    ackRecovery();
  }
}, [isOnline, wasOffline, ...]);
```

**Problema 1**: Cuando `offlineSwitch` pasa a `false`, el componente deja de renderizar `<MapDisplay>` (Leaflet) y renderiza el `<div ref={containerRef}>` (Google Maps). Pero el `useEffect` de inicialización (línea 218) tiene la guarda `if (!containerRef.current || mapRef.current) return;`. Como `mapRef.current` fue limpiado en el cleanup (`mapRef.current = null` en línea 250) al desmontar, el mapa necesita re-inicializarse. Sin embargo, el efecto depende de `[fallbackToLeaflet]` — que NO cambió. `offlineSwitch` no está en sus dependencias. **El mapa Google nunca se re-inicializa.**

**Problema 2**: Incluso si se re-inicializara, los tramos no se repintan porque el efecto de pintar polylines (que depende de `mapReady`) arranca con `mapReady = false` y el efecto de inicialización necesita que el `containerRef.current` exista — pero durante el render con `offlineSwitch = true`, el div no está montado.

**Problema 3**: La variable `offlineSwitch` dentro de `GoogleMapDisplay` es independiente de `offlineSwitchActive` en `MapPage`. Son dos estados duplicados que pueden desincronizarse.

## Solución

Añadir `offlineSwitch` como dependencia del efecto de inicialización del mapa, y asegurar que al volver online se re-cree la instancia de Google Maps correctamente.

### Cambios en `src/components/GoogleMapDisplay.tsx`

1. **Efecto de inicialización** (línea 218): Añadir `offlineSwitch` a las dependencias para que al volver a `false` se re-inicialice el mapa:

```typescript
useEffect(() => {
  if (fallbackToLeaflet || offlineSwitch) return;  // ← añadir offlineSwitch
  if (!containerRef.current || mapRef.current) return;
  // ... resto igual
  return () => { cancelled = true; mapRef.current = null; setMapReady(false); };
}, [fallbackToLeaflet, offlineSwitch]);  // ← añadir offlineSwitch
```

2. **Cleanup del efecto**: Ya hace `mapRef.current = null` y `setMapReady(false)`, lo que permite la re-inicialización correcta.

3. **Efecto de recuperación** (línea 196): Simplificar para que `ackRecovery()` se llame siempre al volver online, evitando que `wasOffline` quede `true` indefinidamente si las condiciones no se alinean:

```typescript
useEffect(() => {
  if (!isOnline && !fallbackToLeaflet) {
    hadGoogleRef.current = hadGoogleRef.current || mapReady;
    setOfflineSwitch(true);
  } else if (isOnline && wasOffline) {
    if (hadGoogleRef.current && !fallbackToLeaflet && offlineSwitch) {
      setOfflineSwitch(false);
    }
    ackRecovery();  // ← siempre limpiar wasOffline
  }
}, [isOnline, wasOffline, fallbackToLeaflet, mapReady, offlineSwitch, ackRecovery]);
```

### Archivo afectado

| Archivo | Cambio |
|---------|--------|
| `src/components/GoogleMapDisplay.tsx` | Corregir dependencias del efecto de init + lógica de recuperación |

### Riesgo

Bajo. Solo se corrigen dependencias de efectos y se asegura la re-inicialización. No afecta al modo offline ni a Leaflet.

