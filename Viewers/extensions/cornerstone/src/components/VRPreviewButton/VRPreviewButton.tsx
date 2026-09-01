import React, { ReactNode } from 'react';
import {
  Button,
  Icons,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useViewportGrid,
} from '@ohif/ui-next';
import classNames from 'classnames';

type VRPreviewButtonProps = {
  viewportId: string;
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
};

export function VRPreviewButton({
  viewportId,
  servicesManager,
  commandsManager,
}: VRPreviewButtonProps): ReactNode {
  const [viewportGrid] = useViewportGrid();
  const isActiveViewport = viewportGrid.activeViewportId === viewportId;
  const tooltip = 'VR 展示';

  const handleClick = () => {
    commandsManager.runCommand('showVRPreview', { viewportId });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tooltip}
          name="vr-preview-button"
          onClick={handleClick}
          className={classNames(
            isActiveViewport ? 'visible' : 'invisible group-hover/pane:visible'
          )}
        >
          <Icons.VolumeRendering className="text-highlight h-5 w-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function getVRPreviewButton(
  props: withAppTypes<{
    viewportId: string;
    servicesManager: AppTypes.ServicesManager;
    commandsManager: AppTypes.CommandsManager;
  }>
): ReactNode {
  return <VRPreviewButton {...props} />;
}
