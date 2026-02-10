import type { Route, Segment } from '@/types/route';

/**
 * Sample route with segments around Madrid for testing without a KML file.
 */
export function generateSampleRoute(): Route {
  const routeId = 'sample_route_001';

  const segments: Segment[] = [
    {
      id: 'seg_01',
      routeId,
      trackNumber: 1,
      kmlId: 'M-30-N-T1',
      name: 'M-30 Norte - Tramo 1',
      notes: '',
      coordinates: [
        { lat: 40.4530, lng: -3.6890 },
        { lat: 40.4560, lng: -3.6870 },
        { lat: 40.4600, lng: -3.6840 },
        { lat: 40.4640, lng: -3.6800 },
        { lat: 40.4670, lng: -3.6760 },
      ],
      direction: 'creciente',
      type: 'tramo',
      status: 'pendiente',
    },
    {
      id: 'seg_02',
      routeId,
      trackNumber: 2,
      kmlId: 'M-30-N-T2',
      name: 'M-30 Norte - Tramo 2',
      notes: '',
      coordinates: [
        { lat: 40.4670, lng: -3.6760 },
        { lat: 40.4700, lng: -3.6720 },
        { lat: 40.4730, lng: -3.6680 },
        { lat: 40.4760, lng: -3.6640 },
      ],
      direction: 'creciente',
      type: 'tramo',
      status: 'pendiente',
    },
    {
      id: 'seg_03',
      routeId,
      trackNumber: 3,
      kmlId: 'A-2-SAL',
      name: 'A-2 Salida Madrid',
      notes: '',
      coordinates: [
        { lat: 40.4380, lng: -3.6600 },
        { lat: 40.4410, lng: -3.6500 },
        { lat: 40.4440, lng: -3.6380 },
        { lat: 40.4470, lng: -3.6260 },
        { lat: 40.4500, lng: -3.6140 },
        { lat: 40.4530, lng: -3.6020 },
      ],
      direction: 'ambos',
      type: 'tramo',
      status: 'pendiente',
    },
    {
      id: 'seg_04',
      routeId,
      trackNumber: 4,
      kmlId: 'ROT-CASTILLA',
      name: 'Rotonda Plaza Castilla',
      notes: '',
      coordinates: [
        { lat: 40.4657, lng: -3.6883 },
        { lat: 40.4662, lng: -3.6875 },
        { lat: 40.4665, lng: -3.6865 },
        { lat: 40.4662, lng: -3.6855 },
        { lat: 40.4657, lng: -3.6850 },
        { lat: 40.4652, lng: -3.6855 },
        { lat: 40.4650, lng: -3.6865 },
        { lat: 40.4652, lng: -3.6875 },
        { lat: 40.4657, lng: -3.6883 },
      ],
      direction: 'ambos',
      type: 'rotonda',
      status: 'pendiente',
    },
    {
      id: 'seg_05',
      routeId,
      trackNumber: 5,
      kmlId: 'M-40-S-VLV',
      name: 'M-40 Sur - Tramo Villaverde',
      notes: '',
      coordinates: [
        { lat: 40.3500, lng: -3.7100 },
        { lat: 40.3530, lng: -3.7000 },
        { lat: 40.3560, lng: -3.6900 },
        { lat: 40.3590, lng: -3.6800 },
        { lat: 40.3620, lng: -3.6700 },
      ],
      direction: 'creciente',
      type: 'tramo',
      status: 'pendiente',
    },
  ];

  return {
    id: routeId,
    name: 'Ruta Ejemplo - Madrid',
    loadedAt: new Date().toISOString(),
    fileName: 'ejemplo_madrid.kml',
    segments,
    optimizedOrder: segments.map((s) => s.id),
  };
}
