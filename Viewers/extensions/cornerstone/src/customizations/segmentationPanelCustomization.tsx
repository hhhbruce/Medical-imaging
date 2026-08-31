import { CustomDropdownMenuContent } from './CustomDropdownMenuContent';
import { CustomSegmentStatisticsHeader } from './CustomSegmentStatisticsHeader';
import React, { useState } from 'react';
import { Switch } from '@ohif/ui-next';

export default function getSegmentationPanelCustomization({ commandsManager, servicesManager }) {
  return {
    'panelSegmentation.customDropdownMenuContent': CustomDropdownMenuContent,
    'panelSegmentation.customSegmentStatisticsHeader': CustomSegmentStatisticsHeader,
    'panelSegmentation.disableEditing': false,
    'panelSegmentation.showAddSegment': true,
    'panelSegmentation.onSegmentationAdd': () => {
      const { viewportGridService } = servicesManager.services;
      const viewportId = viewportGridService.getState().activeViewportId;
      commandsManager.run('createLabelmapForViewport', { viewportId });
    },
    'panelSegmentation.tableMode': 'collapsed',
    'panelSegmentation.readableText': {
      // the values will appear in this order
      min: '最小值',
      minLPS: '最小坐标',
      max: '最大值',
      maxLPS: '最大坐标',
      mean: '平均值',
      stdDev: '标准差',
      count: '体素数量',
      median: '中位数',
      skewness: '偏度',
      kurtosis: '峰度',
      peakValue: '峰值',
      peakLPS: '峰值坐标',
      volume: '体积',
      lesionGlycolysis: '病灶糖酵解',
      center: '中心',
    },
    'segmentationToolbox.config': () => {
      // Get initial states based on current configuration
      const [previewEdits, setPreviewEdits] = useState(false);
      const [toggleSegmentEnabled, setToggleSegmentEnabled] = useState(false);
      const [useCenterAsSegmentIndex, setUseCenterAsSegmentIndex] = useState(false);
      const handlePreviewEditsChange = checked => {
        setPreviewEdits(checked);
        commandsManager.run('toggleSegmentPreviewEdit', { toggle: checked });
      };

      const handleToggleSegmentEnabledChange = checked => {
        setToggleSegmentEnabled(checked);
        commandsManager.run('toggleSegmentSelect', { toggle: checked });
      };

      const handleUseCenterAsSegmentIndexChange = checked => {
        setUseCenterAsSegmentIndex(checked);
        commandsManager.run('toggleUseCenterSegmentIndex', { toggle: checked });
      };

      return (
        <div className="bg-muted flex flex-col gap-4 border-b border-b-[2px] border-border px-2 py-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={previewEdits}
              onCheckedChange={handlePreviewEditsChange}
            />
            <span className="text-base text-white">创建前预览编辑</span>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={useCenterAsSegmentIndex}
              onCheckedChange={handleUseCenterAsSegmentIndexChange}
            />
            <span className="text-base text-white">使用中心作为分割索引</span>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={toggleSegmentEnabled}
              onCheckedChange={handleToggleSegmentEnabledChange}
            />
            <span className="text-base text-white">悬停分割边界以激活</span>
          </div>
        </div>
      );
    },
  };
}
