import React from 'react';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  Icons,
  useSegmentationTableContext,
  useSegmentationExpanded,
} from '@ohif/ui-next';
import { useSystem } from '@ohif/core/src';

/**
 * Custom dropdown menu component for segmentation panel that uses context for data
 */
export const CustomDropdownMenuContent = () => {
  const { commandsManager } = useSystem();
  const {
    onSegmentationAdd,
    onSegmentationRemoveFromViewport,
    onSegmentationEdit,
    onSegmentationDelete,
    exportOptions,
    activeSegmentation,
    activeSegmentationId,
  } = useSegmentationTableContext('CustomDropdownMenu');

  // Try to get segmentation data from expanded context first, fall back to table context
  let segmentation;
  let segmentationId;
  let allowExport = false;

  try {
    // Try to get from expanded context
    const context = useSegmentationExpanded();
    segmentation = context.segmentation;
    segmentationId = segmentation.segmentationId;
  } catch (e) {
    // If not in expanded context, fallback to active segmentation from table context
    segmentation = activeSegmentation;
    segmentationId = activeSegmentationId;
  }

  // Determine if export is allowed for this segmentation
  if (exportOptions && segmentationId) {
    const exportOption = exportOptions.find(opt => opt.segmentationId === segmentationId);
    allowExport = exportOption?.isExportable || false;
  }

  if (!segmentation || !segmentationId) {
    return null;
  }

  const actions = {
    storeSegmentation: async segmentationId => {
      commandsManager.run({
        commandName: 'storeSegmentation',
        commandOptions: { segmentationId },
        context: 'CORNERSTONE',
      });
    },
    onSegmentationDownloadRTSS: segmentationId => {
      commandsManager.run('downloadRTSS', { segmentationId });
    },
    onSegmentationDownload: segmentationId => {
      commandsManager.run('downloadSegmentation', { segmentationId });
    },
    downloadCSVSegmentationReport: segmentationId => {
      commandsManager.run('downloadCSVSegmentationReport', { segmentationId });
    },
  };

  return (
    <DropdownMenuContent align="start">
      <DropdownMenuItem onClick={() => onSegmentationAdd(segmentationId)}>
        <Icons.Add className="text-foreground" />
        <span className="pl-2">新建分割</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>管理当前分割</DropdownMenuLabel>
      <DropdownMenuItem onClick={() => onSegmentationRemoveFromViewport(segmentationId)}>
        <Icons.Series className="text-foreground" />
        <span className="pl-2">从视口移除</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onSegmentationEdit(segmentationId)}>
        <Icons.Rename className="text-foreground" />
        <span className="pl-2">重命名</span>
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="pl-1">
          <Icons.Export className="text-foreground" />
          <span className="pl-2">下载与导出</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            <DropdownMenuLabel className="flex items-center pl-0">
              <Icons.Download className="h-5 w-5" />
              <span className="pl-1">下载</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={e => {
                e.preventDefault();
                actions.downloadCSVSegmentationReport(segmentationId);
              }}
            >
              CSV 报告
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={e => {
                e.preventDefault();
                actions.onSegmentationDownload(segmentationId);
              }}
              disabled={!allowExport}
            >
              DICOM SEG
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={e => {
                e.preventDefault();
                actions.onSegmentationDownloadRTSS(segmentationId);
              }}
              disabled={!allowExport}
            >
              DICOM RTSS
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center pl-0">
              <Icons.Export className="h-5 w-5" />
              <span className="pl-1 pt-1">导出</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={e => {
                e.preventDefault();
                actions.storeSegmentation(segmentationId);
              }}
              disabled={!allowExport}
            >
              DICOM SEG
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onSegmentationDelete(segmentationId)}>
        <Icons.Delete className="text-red-600" />
        <span className="pl-2 text-red-600">删除</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
};
