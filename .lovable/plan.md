

# Fix: Tema claro de Google Maps no se aplica

## Problema

`GoogleMapDisplay.tsx` línea 216 tiene estilos oscuros hardcoded en la inicialización del mapa:
```typescript
styles: [
  { elementType: 'geometry', stylers: [{ color: '#1a1d23' }] },
  // ... todo oscuro
],
```

No escucha el evento `vialroute:map-theme-changed` ni lee `localStorage('vialroute_map_theme')`.

## Solución

### 1. Definir estilos de tema como constantes

```typescript
const DARK_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1d23' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1d23' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3038' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const LIGHT_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
```

Tema claro = estilos por defecto de Google Maps (solo ocultar POIs y tránsito para mantener limpieza visual).

### 2. Leer tema al inicializar el mapa (línea ~211)

```typescript
const savedTheme = (() => {
  try { return localStorage.getItem('vialroute_map_theme') || 'light'; } catch { return 'light'; }
})();

const map = new google.maps.Map(containerRef.current, {
  ...
  styles: savedTheme === 'dark' ? DARK_STYLES : LIGHT_STYLES,
});
```

### 3. Escuchar cambios de tema en caliente

Añadir un `useEffect` que escuche `vialroute:map-theme-changed` y aplique `map.setOptions({ styles: ... })`:

```typescript
useEffect(() => {
  if (!mapReady || !mapRef.current) return;
  const handler = () => {
    const theme = (() => {
      try { return localStorage.getItem('vialroute_map_theme') || 'light'; } catch { return 'light'; }
    })();
    mapRef.current?.setOptions({
      styles: theme === 'dark' ? DARK_STYLES : LIGHT_STYLES,
    });
  };
  window.addEventListener('vialroute:map-theme-changed', handler);
  return () => window.removeEventListener('vialroute:map-theme-changed', handler);
}, [mapReady]);
```

## Archivo afectado

Solo `src/components/GoogleMapDisplay.tsx`.

## Riesgo

Ninguno. `map.setOptions({ styles })` es la API estándar de Google Maps para cambiar estilos en caliente sin re-crear el mapa. No afecta overlays, posición ni zoom.

