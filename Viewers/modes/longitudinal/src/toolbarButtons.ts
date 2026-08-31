import type { Button } from '@ohif/core/types';

import { EVENTS } from '@cornerstonejs/core';
import { ViewportGridService } from '@ohif/core';

const callbacks = (toolName: string) => [
  {
    commandName: 'setViewportForToolConfiguration',
    commandOptions: {
      toolName,
    },
  },
];

export const setToolActiveToolbar = {
  commandName: 'setToolActiveToolbar',
  commandOptions: {
    toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
  },
};

const toggleToolActiveToolbar = {
  commandName: 'toggleToolActiveToolbar',
  commandOptions: {
    toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
  },
};

const toolbarButtons: Button[] = [
  // sections
  {
    id: 'MeasurementTools',
    uiType: 'ohif.toolButtonList',
    props: {
      buttonSection: 'measurementSection',
      groupId: 'MeasurementTools',
    },
  },
  {
    id: 'MoreTools',
    uiType: 'ohif.toolButtonList',
    props: {
      buttonSection: 'moreToolsSection',
      groupId: 'MoreTools',
    },
  },
  {
    id: 'BrushTools',
    uiType: 'ohif.toolBoxButtonGroup',
    props: {
      groupId: 'BrushTools',
      buttonSection: 'brushToolsSection',
    },
  },
  // Section containers for the nested toolbox
  {
    id: 'aiToolBoxContainer',
    uiType: 'ohif.toolBoxButton',
    props: {
      groupId: 'aiToolBoxContainer',
      buttonSection: 'aiToolBoxSection',
    },
  },
  {
    id: 'textPromptSegmentationContainer',
    uiType: 'ohif.toolBoxButton',
    props: {
      groupId: 'textPromptSegmentationContainer',
      buttonSection: 'textPromptSegmentationSection',
    },
  },
  {
    id: 'SegmentationUtilities',
    uiType: 'ohif.toolBoxButton',
    props: {
      groupId: 'SegmentationUtilities',
      buttonSection: 'segmentationToolboxUtilitySection',
    },
  },
  {
    id: 'SegmentationTools',
    uiType: 'ohif.toolBoxButton',
    props: {
      groupId: 'SegmentationTools',
      buttonSection: 'segmentationToolboxToolsSection',
    },
  },
  // tool defs
  {
    id: 'Reset',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-reset',
      label: '重置视图',
      tooltip: '重置视图',
      commands: 'resetViewport',
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'rotate-right',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rotate-right',
      label: '向右旋转',
      tooltip: '旋转 +90°',
      commands: 'rotateViewportCW',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'flipHorizontal',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-flip-horizontal',
      label: '水平翻转',
      tooltip: '水平翻转',
      commands: 'flipViewportHorizontal',
      evaluate: [
        'evaluate.viewportProperties.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ImageSliceSync',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'link',
      label: '图像切片同步',
      tooltip: '在堆栈视口上启用位置同步',
      commands: {
        commandName: 'toggleSynchronizer',
        commandOptions: {
          type: 'imageSlice',
        },
      },
      listeners: {
        [EVENTS.VIEWPORT_NEW_IMAGE_SET]: {
          commandName: 'toggleImageSliceSync',
          commandOptions: { toggledState: true },
        },
      },
      evaluate: [
        'evaluate.cornerstone.synchronizer',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ReferenceLines',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-referenceLines',
      label: '参考线',
      tooltip: '显示参考线',
      commands: 'toggleEnabledDisabledToolbar',
      listeners: {
        [ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED]: callbacks('ReferenceLines'),
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: callbacks('ReferenceLines'),
      },
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'ImageOverlayViewer',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'toggle-dicom-overlay',
      label: '图像叠加',
      tooltip: '切换图像叠加',
      commands: 'toggleEnabledDisabledToolbar',
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'StackScroll',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-stack-scroll',
      label: '堆栈滚动',
      tooltip: '堆栈滚动',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'invert',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-invert',
      label: '反色',
      tooltip: '反色',
      commands: 'invertViewport',
      evaluate: [
        'evaluate.viewportProperties.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'Probe',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-probe',
      label: '探针',
      tooltip: '探针',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Probe2',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'tool-probe',
      label: '点',
      tooltip: '点提示 [P]',
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Cine',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-cine',
      label: '电影播放',
      tooltip: '电影播放',
      commands: 'toggleCine',
      evaluate: [
        'evaluate.cine',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['volume3d'],
        },
      ],
    },
  },
  {
    id: 'Angle',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-angle',
      label: '角度',
      tooltip: '角度',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'CobbAngle',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-cobb-angle',
      label: 'Cobb 角',
      tooltip: 'Cobb 角',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Magnify',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-magnify',
      label: '放大镜',
      tooltip: '放大镜',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'CalibrationLine',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-calibration',
      label: '校准',
      tooltip: '校准线',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'TagBrowser',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'dicom-tag-browser',
      label: 'DICOM 标签浏览器',
      tooltip: 'DICOM 标签浏览器',
      commands: 'openDICOMTagViewer',
    },
  },
  {
    id: 'AdvancedMagnify',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-loupe',
      label: '放大探针',
      tooltip: '放大探针',
      commands: 'toggleActiveDisabledToolbar',
      evaluate: [
        'evaluate.cornerstoneTool.toggle.ifStrictlyDisabled',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'UltrasoundDirectionalTool',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-ultrasound-bidirectional',
      label: '超声方向',
      tooltip: '超声方向',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.modality.supported',
          supportedModalities: ['US'],
        },
      ],
    },
  },
  {
    id: 'WindowLevelRegion',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-window-region',
      label: '窗宽窗位区域',
      tooltip: '窗宽窗位区域',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'Length',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-length',
      label: '长度',
      tooltip: '长度工具',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Bidirectional',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-bidirectional',
      label: '双向',
      tooltip: '双向测量',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'ArrowAnnotate',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-annotate',
      label: '标注',
      tooltip: '箭头标注',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'EllipticalROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-ellipse',
      label: '椭圆',
      tooltip: '椭圆 ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'RectangleROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rectangle',
      label: '矩形',
      tooltip: '矩形 ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'RectangleROI2',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'tool-rectangle',
      label: '边界框',
      tooltip: '边界框 [B]',
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'CircleROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-circle',
      label: '圆形',
      tooltip: '圆形工具',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'PlanarFreehandROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-freehand-roi',
      label: '自由手绘 ROI',
      tooltip: '自由手绘 ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'PlanarFreehandROI3',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-lasso-roi',
      label: '套索',
      tooltip: '套索 [L]',
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'PlanarFreehandROI2',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-freehand-roi',
      label: '涂鸦',
      tooltip: '涂鸦 [S]',
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'SplineROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-spline-roi',
      label: '样条 ROI',
      tooltip: '样条 ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'LivewireContour',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-livewire',
      label: 'Livewire 工具',
      tooltip: 'Livewire 工具',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  // Window Level
  {
    id: 'WindowLevel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-window-level',
      label: '窗宽窗位',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['wholeSlide'],
        },
      ],
    },
  },
  {
    id: 'Pan',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-move',
      label: '平移',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Zoom',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-zoom',
      label: '缩放',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'TrackballRotate',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-3d-rotate',
      label: '3D 旋转',
      commands: setToolActiveToolbar,
      evaluate: {
        name: 'evaluate.cornerstoneTool',
        disabledText: '选择 3D 视口以启用此工具',
      },
    },
  },
  {
    id: 'Capture',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: '截图',
      commands: 'showDownloadViewportModal',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'wholeSlide'],
        },
      ],
    },
  },
  {
    id: 'Layout',
    uiType: 'ohif.layoutSelector',
    props: {
      rows: 3,
      columns: 4,
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'Crosshairs',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-crosshair',
      label: '十字线',
      commands: {
        commandName: 'setToolActiveToolbar',
        commandOptions: {
          toolGroupIds: ['mpr'],
        },
      },
      evaluate: {
        name: 'evaluate.cornerstoneTool',
        disabledText: '选择 MPR 视口以启用此工具',
      },
    },
  },
  {
    id: 'nninter',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'tool-nninter',
      label: '运行分割',
      tooltip: '运行',
      commands: 'runAiSegmentation',
    },
  },
  {
    id: 'undoNninter',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'Undo',
      label: '撤销',
      tooltip: '撤销 (Ctrl+Z)',
      commands: 'undoNninter',
    },
  },
  {
    id: 'textPromptSegmentation',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'tool-voxtell',
      label: '文本提示',
      tooltip: '文本提示分割（VoxTell）',
      commands: 'textPromptSegmentation',
    },
  },
  {
    id: 'testMedgemmaContainer',
    uiType: 'ohif.toolBoxButton',
    props: {
      groupId: 'testMedgemmaContainer',
      buttonSection: 'testMedgemmaSection',
    },
  },
  {
    id: 'testMedgemma',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'tool-voxtell',
      label: '测试 Medgemma',
      tooltip: '测试 Medgemma 1.5 4B',
      commands: 'testMedgemma',
    },
  },
  {
    id: 'sam2',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'tool-sam',
      label: 'SAM2',
      tooltip: 'SAM2',
      commands: 'sam2',
    },
  },
  {
    id: 'resetNninter',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'tool-reset',
      label: '重置分割',
      tooltip: '重置分割',
      commands: 'resetNninter',
    },
  },
  {
    id: 'jumpToSegment',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'tool-target',
      label: '跳转到分段',
      tooltip: '跳转',
      commands: 'jumpToSegment',
    },
  },
  {
    id: 'toggleCurrentSegment',
    uiType: 'ohif.toolBoxButton',
    props: {
      type: 'tool',
      icon: 'eye-visible',
      label: '切换当前分段',
      tooltip: '可见',
      commands: 'toggleCurrentSegment',
    },
  },
  {
    id: 'Brush',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-brush',
      label: '画笔',
      evaluate: {
        name: 'evaluate.cornerstone.segmentation',
        toolNames: ['CircularBrush', 'SphereBrush'],
        disabledText: '请先创建分割以启用此工具。',
      },
      options: [
        {
          name: '半径 (mm)',
          id: 'brush-radius',
          type: 'range',
          min: 0.5,
          max: 99.5,
          step: 0.5,
          value: 25,
          commands: {
            commandName: 'setBrushSize',
            commandOptions: { toolNames: ['CircularBrush', 'SphereBrush'] },
          },
        },
        {
          name: '形状',
          type: 'radio',
          id: 'brush-mode',
          value: 'CircularBrush',
          values: [
            { value: 'CircularBrush', label: '圆形' },
            { value: 'SphereBrush', label: '球形' },
          ],
          commands: 'setToolActiveToolbar',
        },
      ],
    },
  },
  {
    id: 'InterpolateLabelmap',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-interpolation',
      label: '插值标注图',
      tooltip:
        '自动补全已绘制分段之间缺失的切片。请先在至少两个切片上使用画笔或阈值工具，然后点击以在切片之间进行插值。可沿任意方向进行。体积必须可重建。',
      evaluate: [
        'evaluate.cornerstone.segmentation',
        {
          name: 'evaluate.displaySetIsReconstructable',
          disabledText: '当前视口无法进行插值。',
        },
      ],
      commands: 'interpolateLabelmap',
    },
  },
  {
    id: 'SegmentBidirectional',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-bidirectional-segment',
      label: '分割双向测量',
      tooltip:
        '自动检测所选分段在所有切片上的最大长径和短径，并显示双向测量。',
      evaluate: {
        name: 'evaluate.cornerstone.segmentation',
        disabledText: '请先创建分割以启用此工具。',
      },
      commands: 'runSegmentBidirectional',
    },
  },
  {
    id: 'RegionSegmentPlus',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-click-segment',
      label: '一键分割',
      tooltip:
        '单击即可检测可分割区域。悬停可预览——当出现加号时点击可自动分割病灶。',
      evaluate: {
        name: 'evaluate.cornerstone.segmentation',
        toolNames: ['RegionSegmentPlus'],
        disabledText: '请先创建分割以启用此工具。',
      },
      commands: 'setToolActiveToolbar',
    },
  },
  {
    id: 'LabelmapSlicePropagation',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-labelmap-slice-propagation',
      label: '标注图辅助',
      tooltip:
        '切换 AI 辅助分割相邻切片。在切片上绘制后，滚动以预览预测结果。按 Enter 接受，按 Esc 跳过。',
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.cornerstone.hasSegmentation',
        },
      ],
      listeners: {
        [ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED]: callbacks(
          'LabelmapSlicePropagation'
        ),
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: callbacks('LabelmapSlicePropagation'),
      },
      commands: 'toggleEnabledDisabledToolbar',
    },
  },
  {
    id: 'MarkerLabelmap',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-marker-labelmap',
      label: '标记引导标注图',
      tooltip:
        '使用包含/排除标记引导 AI（SAM）分割。点击放置标记，按 Enter 接受结果，按 Esc 拒绝，按 N 保留标记并转到下一层。',
      evaluate: [
        {
          name: 'evaluate.cornerstone.segmentation',
          toolNames: ['MarkerLabelmap', 'MarkerInclude', 'MarkerExclude'],
        },
      ],
      commands: 'setToolActiveToolbar',
      listeners: {
        [ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED]: callbacks('MarkerLabelmap'),
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: callbacks('MarkerLabelmap'),
      },
      options: [
        {
          name: '标记模式',
          type: 'radio',
          id: 'marker-mode',
          value: 'markerInclude',
          values: [
            { value: 'markerInclude', label: '包含' },
            { value: 'markerExclude', label: '排除' },
          ],
          commands: ({ commandsManager, options }) => {
            const markerModeOption = options.find(option => option.id === 'marker-mode');
            if (markerModeOption.value === 'markerInclude') {
              commandsManager.run('setToolActive', {
                toolName: 'MarkerInclude',
              });
            } else {
              commandsManager.run('setToolActive', {
                toolName: 'MarkerExclude',
              });
            }
          },
        },
        {
          name: '清除标记',
          type: 'button',
          id: 'clear-markers',
          commands: 'clearMarkersForMarkerLabelmap',
        },
      ],
    },
  },
  {
    id: 'Eraser',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-eraser',
      label: '橡皮擦',
      evaluate: {
        name: 'evaluate.cornerstone.segmentation',
        toolNames: ['CircularEraser', 'SphereEraser'],
      },
      options: [
        {
          name: '半径 (mm)',
          id: 'eraser-radius',
          type: 'range',
          min: 0.5,
          max: 99.5,
          step: 0.5,
          value: 25,
          commands: {
            commandName: 'setBrushSize',
            commandOptions: { toolNames: ['CircularEraser', 'SphereEraser'] },
          },
        },
        {
          name: '形状',
          type: 'radio',
          id: 'eraser-mode',
          value: 'CircularEraser',
          values: [
            { value: 'CircularEraser', label: '圆形' },
            { value: 'SphereEraser', label: '球形' },
          ],
          commands: 'setToolActiveToolbar',
        },
      ],
    },
  },
  {
    id: 'Threshold',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-threshold',
      label: '阈值工具',
      evaluate: {
        name: 'evaluate.cornerstone.segmentation',
        toolNames: [
          'ThresholdCircularBrush',
          'ThresholdSphereBrush',
          'ThresholdCircularBrushDynamic',
          'ThresholdSphereBrushDynamic',
        ],
      },
      options: [
        {
          name: '半径 (mm)',
          id: 'threshold-radius',
          type: 'range',
          min: 0.5,
          max: 99.5,
          step: 0.5,
          value: 25,
          commands: {
            commandName: 'setBrushSize',
            commandOptions: {
              toolNames: [
                'ThresholdCircularBrush',
                'ThresholdSphereBrush',
                'ThresholdCircularBrushDynamic',
                'ThresholdSphereBrushDynamic',
              ],
            },
          },
        },
        {
          name: '形状',
          type: 'radio',
          id: 'threshold-shape',
          value: 'ThresholdCircularBrush',
          values: [
            { value: 'ThresholdCircularBrush', label: '圆形' },
            { value: 'ThresholdSphereBrush', label: '球形' },
          ],
          commands: ({ value, commandsManager, options }) => {
            const optionsDynamic = options.find(option => option.id === 'dynamic-mode');

            if (optionsDynamic.value === 'ThresholdDynamic') {
              commandsManager.run('setToolActive', {
                toolName:
                  value === 'ThresholdCircularBrush'
                    ? 'ThresholdCircularBrushDynamic'
                    : 'ThresholdSphereBrushDynamic',
              });
            } else {
              commandsManager.run('setToolActive', {
                toolName: value,
              });
            }
          },
        },
        {
          name: '阈值',
          type: 'radio',
          id: 'dynamic-mode',
          value: 'ThresholdDynamic',
          values: [
            { value: 'ThresholdDynamic', label: '动态' },
            { value: 'ThresholdRange', label: '范围' },
          ],
          commands: ({ value, commandsManager, options }) => {
            const thresholdRangeOption = options.find(option => option.id === 'threshold-shape');

            if (value === 'ThresholdDynamic') {
              commandsManager.run('setToolActiveToolbar', {
                toolName:
                  thresholdRangeOption.value === 'ThresholdCircularBrush'
                    ? 'ThresholdCircularBrushDynamic'
                    : 'ThresholdSphereBrushDynamic',
              });
            } else {
              commandsManager.run('setToolActiveToolbar', {
                toolName: thresholdRangeOption.value,
              });

              const thresholdRangeValue = options.find(
                option => option.id === 'threshold-range'
              ).value;

              commandsManager.run('setThresholdRange', {
                toolNames: ['ThresholdCircularBrush', 'ThresholdSphereBrush'],
                value: thresholdRangeValue,
              });
            }
          },
        },
        {
          name: '阈值范围',
          type: 'double-range',
          id: 'threshold-range',
          min: -1000,
          max: 1000,
          step: 1,
          value: [50, 600],
          condition: ({ options }) =>
            options.find(option => option.id === 'dynamic-mode').value === 'ThresholdRange',
          commands: {
            commandName: 'setThresholdRange',
            commandOptions: {
              toolNames: ['ThresholdCircularBrush', 'ThresholdSphereBrush'],
            },
          },
        },
      ],
    },
  },
  {
    id: 'Shapes',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'icon-tool-shape',
      label: '形状',
      evaluate: {
        name: 'evaluate.cornerstone.segmentation',
        toolNames: ['CircleScissor', 'SphereScissor', 'RectangleScissor'],
        disabledText: '请先创建分割以启用形状工具。',
      },
      options: [
        {
          name: '形状',
          type: 'radio',
          value: 'CircleScissor',
          id: 'shape-mode',
          values: [
            { value: 'CircleScissor', label: '圆形' },
            { value: 'SphereScissor', label: '球形' },
            { value: 'RectangleScissor', label: '矩形' },
          ],
          commands: 'setToolActiveToolbar',
        },
      ],
    },
  },
  // {
  //   id: 'Undo',
  //   uiType: 'ohif.toolButton',
  //   props: {
  //     type: 'tool',
  //     icon: 'prev-arrow',
  //     label: 'Undo',
  //     commands: {
  //       commandName: 'undo',
  //     },
  //     evaluate: 'evaluate.action',
  //   },
  // },
  // {
  //   id: 'Redo',
  //   uiType: 'ohif.toolButton',
  //   props: {
  //     type: 'tool',
  //     icon: 'next-arrow',
  //     label: 'Redo',
  //     commands: {
  //       commandName: 'redo',
  //     },
  //     evaluate: 'evaluate.action',
  //   },
  // },
];

export default toolbarButtons;
