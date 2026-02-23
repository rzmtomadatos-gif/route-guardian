

# Soporte de capas (Folders) en archivos KML/KMZ

## Problema actual
El parser usa `kml()` de `@tmcw/togeojson`, que aplana todas las capas del KML en una lista plana de features. Si el archivo tiene varias carpetas/capas (ej: "Troncos", "Ramales", "Rotondas"), se pierden y todos los tramos se mezclan sin distincion.

## Solucion
Usar `kmlWithFolders()` de la misma libreria, que devuelve un arbol con la estructura de carpetas del KML. Cada segmento se asociara a su capa de origen, permitiendo filtrar y agrupar por capa.

## Cambios previstos

### 1. Tipo `Segment` - nuevo campo `layer`
Anadir un campo `layer` (string opcional) al tipo `Segment` en `src/types/route.ts` para almacenar el nombre de la carpeta/capa de origen.

### 2. Parser KML - usar `kmlWithFolders`
Modificar `src/utils/kml-parser.ts`:
- Importar `kmlWithFolders` en lugar de `kml`
- Recorrer recursivamente el arbol de carpetas (Root -> Folder -> children)
- Asignar el nombre de la carpeta padre como `layer` a cada segmento
- Mantener la misma logica de extraccion de metadatos y coordenadas

### 3. Vista de tramos - filtro por capa
Modificar `src/pages/SegmentsPage.tsx`:
- Extraer las capas unicas de los segmentos cargados
- Anadir un selector/filtro de capa junto a los filtros existentes (estado, busqueda)
- Mostrar la capa de cada segmento como etiqueta visual en la lista

---

## Detalles tecnicos

La funcion `kmlWithFolders()` devuelve esta estructura:

```text
Root
 +-- children[]
      +-- Folder { type: "folder", meta: { name: "Capa 1" }, children: [...] }
      |    +-- Feature (GeoJSON)
      |    +-- Folder (subcapa anidada)
      +-- Feature (sin carpeta)
```

La funcion recursiva recorrera el arbol pasando el nombre de la carpeta actual como parametro `layer`. Los features que no esten dentro de ninguna carpeta tendran `layer` sin definir.

**Archivos a modificar:**
- `src/types/route.ts` - anadir campo `layer?: string` a `Segment`
- `src/utils/kml-parser.ts` - cambiar a `kmlWithFolders`, recorrer arbol recursivo
- `src/pages/SegmentsPage.tsx` - filtro y etiqueta de capa

