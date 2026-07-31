import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import { Enums, VolumeViewport3D } from '@cornerstonejs/core';
import {
  Button,
  Icons,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useViewportGrid,
} from '@ohif/ui-next';
import classNames from 'classnames';

type VolumeVisibilityState = {
  hasSourceVolume: boolean;
  isSegmentationOnly: boolean;
};

const DEFAULT_VISIBILITY_STATE: VolumeVisibilityState = {
  hasSourceVolume: false,
  isSegmentationOnly: false,
};

type SourceVolumeActor = {
  getVisibility: () => boolean;
  setVisibility: (isVisible: boolean) => void;
};

type SourceVolumeActorEntry = {
  actor: SourceVolumeActor;
};

const isSourceVolumeActor = (actor: unknown): actor is SourceVolumeActor => {
  const candidate = actor as SourceVolumeActor & {
    isA?: (className: string) => boolean;
  };

  return (
    candidate?.isA?.('vtkVolume') === true &&
    typeof candidate.getVisibility === 'function' &&
    typeof candidate.setVisibility === 'function'
  );
};

const getSourceVolumeActors = (
  viewport: VolumeViewport3D,
  displaySets: AppTypes.DisplaySet[]
): SourceVolumeActorEntry[] => {
  const sourceDisplaySetUIDs = displaySets
    .filter(displaySet => !['SEG', 'RTSTRUCT'].includes(displaySet.Modality))
    .map(displaySet => displaySet.displaySetInstanceUID)
    .filter(Boolean);

  return viewport.getActors().flatMap<SourceVolumeActorEntry>(({ actor, referencedId }) => {
    const belongsToSourceDisplaySet = sourceDisplaySetUIDs.some(displaySetUID =>
      referencedId?.includes(displaySetUID)
    );

    return isSourceVolumeActor(actor) && belongsToSourceDisplaySet ? [{ actor }] : [];
  });
};

export function SegmentationOnlyToggle({
  viewportId,
  element,
  displaySets,
  servicesManager,
}: withAppTypes<{
  viewportId: string;
  element: HTMLElement;
  displaySets: AppTypes.DisplaySet[];
}>): ReactNode {
  const { cornerstoneViewportService } = servicesManager.services;
  const [viewportGrid] = useViewportGrid();
  const [visibilityState, setVisibilityState] =
    useState<VolumeVisibilityState>(DEFAULT_VISIBILITY_STATE);

  const syncVisibilityState = useCallback(() => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!(viewport instanceof VolumeViewport3D)) {
      setVisibilityState(DEFAULT_VISIBILITY_STATE);
      return;
    }

    const sourceVolumeActors = getSourceVolumeActors(viewport, displaySets);
    const hasVisibleSourceVolume = sourceVolumeActors.some(({ actor }) => actor.getVisibility());

    setVisibilityState({
      hasSourceVolume: sourceVolumeActors.length > 0,
      isSegmentationOnly: sourceVolumeActors.length > 0 && !hasVisibleSourceVolume,
    });
  }, [cornerstoneViewportService, displaySets, viewportId]);

  useEffect(() => {
    syncVisibilityState();

    const handleNewVolume = () => syncVisibilityState();
    const { unsubscribe } = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
      ({ viewportId: changedViewportId }) => {
        if (changedViewportId === viewportId) {
          syncVisibilityState();
        }
      }
    );

    element?.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, handleNewVolume);

    return () => {
      unsubscribe();
      element?.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, handleNewVolume);
    };
  }, [cornerstoneViewportService, element, syncVisibilityState, viewportId]);

  const toggleSegmentationOnly = useCallback(() => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!(viewport instanceof VolumeViewport3D)) {
      return;
    }

    const sourceVolumeActors = getSourceVolumeActors(viewport, displaySets);
    const shouldRestoreSourceVolume =
      sourceVolumeActors.length > 0 &&
      sourceVolumeActors.every(({ actor }) => !actor.getVisibility());

    sourceVolumeActors.forEach(({ actor }) => actor.setVisibility(shouldRestoreSourceVolume));
    viewport.render();
    syncVisibilityState();
  }, [cornerstoneViewportService, displaySets, syncVisibilityState, viewportId]);

  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  if (!(viewport instanceof VolumeViewport3D)) {
    return null;
  }

  const isActiveViewport = viewportGrid.activeViewportId === viewportId;
  const tooltip = visibilityState.isSegmentationOnly
    ? '恢复 CT 体渲染'
    : '仅显示 AI 分割（隐藏 CT 体渲染）';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tooltip}
          aria-pressed={visibilityState.isSegmentationOnly}
          name="segmentation-only-toggle"
          disabled={!visibilityState.hasSourceVolume}
          onClick={toggleSegmentationOnly}
          className={classNames(
            visibilityState.isSegmentationOnly && 'bg-primary/25',
            isActiveViewport ? 'visible' : 'invisible group-hover/pane:visible'
          )}
        >
          <Icons.GroupLayers className="text-highlight h-5 w-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function getSegmentationOnlyToggle(
  props: withAppTypes<{
    viewportId: string;
    element: HTMLElement;
    displaySets: AppTypes.DisplaySet[];
  }>
): ReactNode {
  return <SegmentationOnlyToggle {...props} />;
}
