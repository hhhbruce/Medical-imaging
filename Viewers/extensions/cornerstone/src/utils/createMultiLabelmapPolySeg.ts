import {
  Enums as CoreEnums,
  cache,
  eventTarget,
  geometryLoader,
  getWebWorkerManager,
  triggerEvent,
} from '@cornerstonejs/core';
import { Enums as ToolsEnums, segmentation as cornerstoneSegmentation } from '@cornerstonejs/tools';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

const { SegmentationRepresentations, WorkerTypes } = ToolsEnums;
const workerManager = getWebWorkerManager();
const surfaceComputationRequests = new Map<string, Promise<{ geometryIds: Map<number, string> }>>();

const getLabelmapLayers = labelmapData => Object.values(labelmapData?.labelmaps ?? {});

const isMultiLayerLabelmap = labelmapData => getLabelmapLayers(labelmapData).length > 1;

const getSegmentIndices = (segmentation, options) =>
  options.segmentIndices?.length
    ? options.segmentIndices
    : Object.keys(segmentation.segments ?? {})
        .map(Number)
        .filter(segmentIndex => Number.isFinite(segmentIndex) && segmentIndex > 0);

const getLayerForSegment = (labelmapData, segmentIndex) => {
  const binding = labelmapData.segmentBindings?.[segmentIndex];
  const layer = binding ? labelmapData.labelmaps?.[binding.labelmapId] : undefined;

  return {
    labelValue: binding?.labelValue ?? segmentIndex,
    layer: layer ?? getLabelmapLayers(labelmapData)[0],
  };
};

const getLayerVolume = async layer => {
  const cachedVolumeId = layer.volumeId ?? layer.geometryVolumeId;
  const cachedVolume = cachedVolumeId ? cache.getVolume(cachedVolumeId) : undefined;

  if (cachedVolume) {
    return cachedVolume;
  }

  if (!layer.imageIds?.length) {
    throw new Error(`Labelmap layer ${layer.labelmapId} has no volume or imageIds`);
  }

  const { volumeId } = await cornerstoneSegmentation.helpers.computeVolumeLabelmapFromStack({
    imageIds: layer.imageIds,
  });
  return cache.getVolume(volumeId);
};

const hasLabelValue = (scalarData, labelValue) => {
  if (!scalarData?.length) {
    return false;
  }

  for (let index = 0; index < scalarData.length; index++) {
    if (scalarData[index] === labelValue) {
      return true;
    }
  }

  return false;
};

const isRenderableSurface = data =>
  data?.points?.length >= 3 && data.points.length % 3 === 0 && data?.polys?.length >= 4;

const computeLayerSurface = async (layer, labelValue, segmentIndex) => {
  const volume = await getLayerVolume(layer);

  if (!volume) {
    throw new Error(`Unable to create a volume for labelmap layer ${layer.labelmapId}`);
  }

  const { dimensions, spacing, origin, direction } = volume;
  const scalarData = volume.voxelManager.getCompleteScalarDataArray();

  if (!hasLabelValue(scalarData, labelValue)) {
    return { data: null, segmentIndex };
  }

  triggerEvent(eventTarget, CoreEnums.Events.WEB_WORKER_PROGRESS, {
    progress: 0,
    type: WorkerTypes.POLYSEG_LABELMAP_TO_SURFACE,
    id: segmentIndex,
  });

  const surface = await workerManager.executeTask(
    'polySeg',
    'convertLabelmapToSurface',
    {
      scalarData,
      dimensions,
      spacing,
      origin,
      direction,
      segmentIndex: labelValue,
    },
    {
      callbacks: [
        progress => {
          triggerEvent(eventTarget, CoreEnums.Events.WEB_WORKER_PROGRESS, {
            progress,
            type: WorkerTypes.POLYSEG_LABELMAP_TO_SURFACE,
            id: segmentIndex,
          });
        },
      ],
    }
  );

  triggerEvent(eventTarget, CoreEnums.Events.WEB_WORKER_PROGRESS, {
    progress: 100,
    type: WorkerTypes.POLYSEG_LABELMAP_TO_SURFACE,
    id: segmentIndex,
  });

  return { data: surface, segmentIndex };
};

const createSurfaceGeometries = async (segmentationId, surfaces, viewport) => {
  const geometryIds = new Map<number, string>();

  await Promise.all(
    surfaces.map(async ({ data, segmentIndex }) => {
      const geometryId = `segmentation_${segmentationId}_surface_${segmentIndex}`;

      if (cache.getGeometry(geometryId)) {
        cache.removeGeometryLoadObject(geometryId);
      }

      if (!isRenderableSurface(data)) {
        if (data) {
          console.warn(
            `[multiLayerPolySeg] Skipping malformed surface for segment ${segmentIndex}`,
            data
          );
        }
        return;
      }

      const color = cornerstoneSegmentation.config.color
        .getSegmentIndexColor(viewport.id, segmentationId, segmentIndex)
        .slice(0, 3);

      await geometryLoader.createAndCacheGeometry(geometryId, {
        type: CoreEnums.GeometryType.SURFACE,
        geometryData: {
          id: geometryId,
          color,
          frameOfReferenceUID: viewport.getFrameOfReferenceUID(),
          points: data.points,
          polys: data.polys,
          segmentIndex,
        },
      });
      geometryIds.set(segmentIndex, geometryId);
    })
  );

  return { geometryIds };
};

const computeMultiLayerSurfaceDataInternal = async (segmentationId, options = {}) => {
  const segmentation = cornerstoneSegmentation.state.getSegmentation(segmentationId);
  const labelmapData = segmentation?.representationData?.[SegmentationRepresentations.Labelmap];
  const viewport = options.viewport;

  if (!segmentation || !labelmapData || !viewport) {
    throw new Error(`Missing segmentation, labelmap data, or viewport for ${segmentationId}`);
  }

  const surfaces = await Promise.all(
    getSegmentIndices(segmentation, options).map(segmentIndex => {
      const { layer, labelValue } = getLayerForSegment(labelmapData, segmentIndex);

      if (!layer) {
        throw new Error(`No labelmap layer found for segment ${segmentIndex}`);
      }

      return computeLayerSurface(layer, labelValue, segmentIndex);
    })
  );

  return createSurfaceGeometries(segmentationId, surfaces, viewport);
};

const computeMultiLayerSurfaceData = async (segmentationId, options = {}) => {
  const pendingRequest = surfaceComputationRequests.get(segmentationId);

  if (pendingRequest) {
    return pendingRequest;
  }

  const request = computeMultiLayerSurfaceDataInternal(segmentationId, options);
  surfaceComputationRequests.set(segmentationId, request);

  try {
    return await request;
  } finally {
    if (surfaceComputationRequests.get(segmentationId) === request) {
      surfaceComputationRequests.delete(segmentationId);
    }
  }
};

const computeSurfaceData = async (segmentationId, options = {}) => {
  const segmentation = cornerstoneSegmentation.state.getSegmentation(segmentationId);
  const labelmapData = segmentation?.representationData?.[SegmentationRepresentations.Labelmap];

  if (!isMultiLayerLabelmap(labelmapData)) {
    return polySeg.computeSurfaceData(segmentationId, options);
  }

  return computeMultiLayerSurfaceData(segmentationId, options);
};

const updateSurfaceData = async (segmentationId, options = {}) => {
  const segmentation = cornerstoneSegmentation.state.getSegmentation(segmentationId);
  const labelmapData = segmentation?.representationData?.[SegmentationRepresentations.Labelmap];

  if (!isMultiLayerLabelmap(labelmapData)) {
    return polySeg.updateSurfaceData(segmentationId, options);
  }

  const surfaceData = await computeMultiLayerSurfaceData(segmentationId, options);
  segmentation.representationData[SegmentationRepresentations.Surface] = surfaceData;
  cornerstoneSegmentation.triggerSegmentationEvents.triggerSegmentationModified(segmentationId);
};

export const multiLayerPolySeg = {
  ...polySeg,
  computeSurfaceData,
  updateSurfaceData,
};
