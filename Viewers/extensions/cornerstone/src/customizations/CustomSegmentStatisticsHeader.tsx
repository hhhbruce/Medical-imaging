import * as cornerstoneTools from '@cornerstonejs/tools';
import React, { useState, useEffect } from 'react';
import { Separator, Button, Tooltip, TooltipTrigger, TooltipContent, Icons } from '@ohif/ui-next';
import { roundNumber } from '@ohif/core/src/utils';
import { useSystem } from '@ohif/core/src';

interface CustomSegmentStatisticsHeaderProps {
  segmentationId: string;
  segmentIndex: number;
}

/**
 * Custom header component for segment statistics
 */
export const CustomSegmentStatisticsHeader = ({
  segmentationId,
  segmentIndex,
}: CustomSegmentStatisticsHeaderProps) => {
  const { servicesManager, commandsManager } = useSystem();
  const { segmentationService } = servicesManager.services;
  
  // Add state to track if bidirectional has been computed
  const [bidirectionalComputed, setBidirectionalComputed] = useState(false);

  const segmentation = segmentationService.getSegmentation(segmentationId);
  const segment = segmentation?.segments?.[segmentIndex];
  const cachedStats = segment?.cachedStats;
  const namedStats = cachedStats?.namedStats;

  // Run bidirectional computation once. This hook MUST run on every render — hooks cannot be
  // conditional. namedStats appears/disappears while stats compute (statsPending/"Calculating"),
  // so keeping the effect BEFORE the early returns preserves a stable hook order; otherwise the
  // hook count changes between renders and React throws "Rendered fewer hooks than expected"
  // (surfaced by the ErrorBoundary as "Something went wrong").
  useEffect(() => {
    if (namedStats && !namedStats.bidirectional && !bidirectionalComputed) {
      setBidirectionalComputed(true);
      commandsManager.run('runSegmentBidirectional', {
        segmentationId,
        segmentIndex,
      });
    }
  }, [namedStats?.bidirectional, bidirectionalComputed, segmentationId, segmentIndex, commandsManager, namedStats]);

  if (!namedStats) {
    return null;
  }

  if (!namedStats.bidirectional) {
    return (
      <div className="-mt-2 space-y-2">
        <div className="flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary flex items-center px-0"
              >
                <span>无法计算双向测量</span>
              </Button>
            </TooltipTrigger>
          </Tooltip>
        </div>
        <Separator className="bg-input" />
      </div>
    );
  }
  const bidirectional = namedStats.bidirectional;

  const { value, unit } = bidirectional;
  const maxMajor = value.maxMajor;
  const maxMinor = value.maxMinor;

  const max = Math.max(maxMajor, maxMinor);
  const min = Math.min(maxMajor, maxMinor);

  const isVisible = cornerstoneTools.annotation.visibility.isAnnotationVisible(
    bidirectional.annotationUID
  );

  return (
    <div className="-mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-foreground">
          <div>
            长: {roundNumber(max)} {unit}
          </div>
          <div>
            宽: {roundNumber(min)} {unit}
          </div>
        </div>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={`h-6 w-6 transition-opacity`}
                onClick={e => {
                  e.stopPropagation();
                  cornerstoneTools.annotation.visibility.setAnnotationVisibility(
                    bidirectional.annotationUID,
                    !isVisible
                  );

                  segmentationService.addOrUpdateSegmentation({
                    segmentationId,
                  });

                  if (isVisible === false) {
                    commandsManager.run('jumpToMeasurement', {
                      uid: bidirectional.annotationUID,
                    });
                  }
                }}
              >
                {isVisible ? (
                  <Icons.Hide className="h-6 w-6" />
                ) : (
                  <Icons.Show className="h-6 w-6" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">切换可见性</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <Separator className="bg-input" />
    </div>
  );
};
