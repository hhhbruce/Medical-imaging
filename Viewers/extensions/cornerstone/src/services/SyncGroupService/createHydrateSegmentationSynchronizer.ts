import {
  Enums as CoreEnums,
  Types,
  cache,
  getEnabledElementByViewportId,
  metaData,
} from '@cornerstonejs/core';
import {
  SynchronizerManager,
  Synchronizer,
  Enums,
  Types as ToolsTypes,
} from '@cornerstonejs/tools';

const { createSynchronizer } = SynchronizerManager;
const { SEGMENTATION_REPRESENTATION_MODIFIED } = Enums.Events;
const { SegmentationRepresentations } = Enums;
const { BlendModes } = CoreEnums;

const hydrationRequests = new Map<string, Promise<void>>();

const addSegmentationRepresentationOnce = async (
  targetViewportId: string,
  segmentationId: string,
  type: ToolsTypes.SegmentationRepresentation['type'],
  servicesManager: AppTypes.ServicesManager,
  config?: { blendMode?: CoreEnums.BlendModes }
): Promise<void> => {
  const { segmentationService } = servicesManager.services;
  const requestKey = `${targetViewportId}:${segmentationId}`;
  const pendingRequest = hydrationRequests.get(requestKey);

  if (pendingRequest) {
    return pendingRequest;
  }

  if (
    segmentationService.getSegmentationRepresentations(targetViewportId, { segmentationId })
      .length > 0
  ) {
    return;
  }

  const request = segmentationService.addSegmentationRepresentation(targetViewportId, {
    segmentationId,
    type,
    config,
  });
  hydrationRequests.set(requestKey, request);

  try {
    await request;
  } finally {
    if (hydrationRequests.get(requestKey) === request) {
      hydrationRequests.delete(requestKey);
    }
  }
};

const getSegmentationFrameOfReferenceUID = (
  segmentation: ToolsTypes.Segmentation
): string | undefined => {
  const labelmapData = segmentation.representationData?.[SegmentationRepresentations.Labelmap];

  if (!labelmapData) {
    return;
  }

  const labelmaps = Object.values(labelmapData.labelmaps ?? {});
  const referencedImageId = labelmapData.referencedImageIds?.[0];
  const labelmapImageId =
    labelmapData.imageIds?.[0] ??
    labelmaps.find(labelmap => labelmap.imageIds?.length)?.imageIds?.[0];
  const volumeId =
    labelmapData.referencedVolumeId ??
    labelmapData.volumeId ??
    labelmaps.find(labelmap => labelmap.volumeId)?.volumeId;
  const volumeImageId = volumeId ? cache.getVolume(volumeId)?.imageIds?.[0] : undefined;
  const imageId = referencedImageId ?? labelmapImageId ?? volumeImageId;

  if (!imageId) {
    return;
  }

  return (
    cache.getImage(imageId)?.FrameOfReferenceUID ??
    metaData.get('imagePlaneModule', imageId)?.frameOfReferenceUID
  );
};

export const hydrateExistingSegmentations = async (
  targetViewportId: string,
  servicesManager: AppTypes.ServicesManager
): Promise<void> => {
  const { segmentationService } = servicesManager.services;
  const enabledElement = getEnabledElementByViewportId(targetViewportId);

  if (!enabledElement) {
    return;
  }

  const targetFrameOfReferenceUID = enabledElement.viewport.getFrameOfReferenceUID();

  if (!targetFrameOfReferenceUID) {
    return;
  }

  for (const segmentation of segmentationService.getSegmentations()) {
    const { segmentationId } = segmentation;
    const labelmapData = segmentation.representationData?.[SegmentationRepresentations.Labelmap];
    const targetRepresentations = segmentationService.getSegmentationRepresentations(
      targetViewportId,
      { segmentationId }
    );

    const segmentationFrameOfReferenceUID = getSegmentationFrameOfReferenceUID(segmentation);

    if (
      !labelmapData ||
      (segmentationFrameOfReferenceUID &&
        segmentationFrameOfReferenceUID !== targetFrameOfReferenceUID) ||
      targetRepresentations.length > 0
    ) {
      continue;
    }

    try {
      await addSegmentationRepresentationOnce(
        targetViewportId,
        segmentationId,
        SegmentationRepresentations.Labelmap,
        servicesManager
      );
    } catch (error) {
      console.warn(
        `Failed to hydrate segmentation ${segmentationId} in viewport ${targetViewportId}`,
        error
      );
    }
  }
};

export default function createHydrateSegmentationSynchronizer(
  synchronizerName: string,
  { servicesManager, ...options }: { servicesManager: AppTypes.ServicesManager; options }
): Synchronizer {
  const stackImageSynchronizer = createSynchronizer(
    synchronizerName,
    SEGMENTATION_REPRESENTATION_MODIFIED,
    (synchronizerInstance, sourceViewport, targetViewport, sourceEvent) => {
      return segmentationRepresentationModifiedCallback(
        synchronizerInstance,
        sourceViewport,
        targetViewport,
        sourceEvent,
        { servicesManager, options }
      );
    },
    {
      eventSource: 'eventTarget',
    }
  );

  return stackImageSynchronizer;
}

const segmentationRepresentationModifiedCallback = async (
  synchronizerInstance: Synchronizer,
  sourceViewport: Types.IViewportId,
  targetViewport: Types.IViewportId,
  sourceEvent: Event,
  { servicesManager, options }: { servicesManager: AppTypes.ServicesManager; options: unknown }
) => {
  const event = sourceEvent as ToolsTypes.EventTypes.SegmentationRepresentationModifiedEventType;

  const { segmentationId } = event.detail;
  const { segmentationService } = servicesManager.services;

  const targetViewportId = targetViewport.viewportId;
  const enabledElement = getEnabledElementByViewportId(targetViewportId);

  if (!enabledElement) {
    return;
  }

  const { viewport } = enabledElement;
  const targetFrameOfReferenceUID = viewport.getFrameOfReferenceUID();

  if (!targetFrameOfReferenceUID) {
    return;
  }

  // Whatever type the source viewport has, we need to add that to the target viewport.
  const sourceViewportRepresentation = segmentationService.getSegmentationRepresentations(
    sourceViewport.viewportId,
    { segmentationId }
  )[0];

  if (!sourceViewportRepresentation) {
    return;
  }

  const targetViewportRepresentation = segmentationService.getSegmentationRepresentations(
    targetViewportId,
    { segmentationId }
  )[0];

  if (targetViewportRepresentation) {
    Object.values(sourceViewportRepresentation.segments).forEach(sourceSegment => {
      const targetSegment = targetViewportRepresentation.segments[sourceSegment.segmentIndex];

      if (!targetSegment) {
        return;
      }

      if (targetSegment.visible !== sourceSegment.visible) {
        segmentationService.setSegmentVisibility(
          targetViewportId,
          segmentationId,
          sourceSegment.segmentIndex,
          sourceSegment.visible,
          targetViewportRepresentation.type
        );
      }

      if (sourceSegment.color.some((value, index) => value !== targetSegment.color[index])) {
        segmentationService.setSegmentColor(
          targetViewportId,
          segmentationId,
          sourceSegment.segmentIndex,
          sourceSegment.color
        );
      }
    });
    return;
  }

  const segmentation = segmentationService.getSegmentation(segmentationId);
  const segmentationFrameOfReferenceUID = segmentation
    ? getSegmentationFrameOfReferenceUID(segmentation)
    : undefined;

  if (
    segmentationFrameOfReferenceUID &&
    segmentationFrameOfReferenceUID !== targetFrameOfReferenceUID
  ) {
    return;
  }

  await addSegmentationRepresentationOnce(
    targetViewportId,
    segmentationId,
    sourceViewportRepresentation.type,
    servicesManager,
    {
      blendMode:
        viewport.getBlendMode() === 1 ? BlendModes.LABELMAP_EDGE_PROJECTION_BLEND : undefined,
    }
  );
};
