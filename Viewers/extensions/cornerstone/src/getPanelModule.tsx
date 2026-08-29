import React from 'react';

// Toolbox 用于在侧边栏中展示一组工具栏按钮。
import { Toolbox } from '@ohif/extension-default';
// 分割面板：显示和管理当前视口中的分割结果。
import PanelSegmentation from './panels/PanelSegmentation';
// 当前视口的窗宽窗位面板。
import ActiveViewportWindowLevel from './components/ActiveViewportWindowLevel';
// 测量面板：显示和管理长度、角度等测量结果。
import PanelMeasurement from './panels/PanelMeasurement';

/**
 * 注册 Cornerstone 扩展提供的侧边栏面板。
 *
 * 一个面板模块通常包含以下信息：
 * - name：模块的内部名称；
 * - iconName：侧边栏 Tab 使用的图标；
 * - iconLabel：图标的辅助文本；
 * - label：侧边栏 Tab 显示的标题；
 * - component：点击或激活 Tab 后实际渲染的 React 组件。
 *
 * 这些模块会被 PanelService 注册，查看模式通过类似下面的 namespace 使用它们：
 * @ohif/extension-cornerstone.panelModule.panelSegmentationWithTools
 */
const getPanelModule = ({ commandsManager, servicesManager, extensionManager }: withAppTypes) => {
  /**
   * 普通分割面板包装器。
   *
   * 这里将系统级管理器注入 PanelSegmentation，使分割面板可以：
   * - 执行分割相关命令；
   * - 读取和更新服务状态；
   * - 获取扩展注册的其他模块。
   */
  const wrappedPanelSegmentation = ({ configuration }) => {
    return (
      <PanelSegmentation
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        configuration={{
          ...configuration,
        }}
      />
    );
  };

  /**
   * 不带额外头部的分割面板包装器。
   *
   * 当前实现与普通分割面板使用相同的 PanelSegmentation 组件，
   * 但单独注册为一个模块，方便不同 Mode 选择不同的面板配置。
   */
  const wrappedPanelSegmentationNoHeader = ({ configuration }) => {
    return (
      <PanelSegmentation
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        configuration={{
          ...configuration,
        }}
      />
    );
  };

  /**
   * 带工具箱的分割面板包装器。
   *
   * 这是基础查看器右侧面板当前使用的主要组件。它将多个工具箱和
   * 分割结果管理面板组合在同一个右侧 Tab 中。
   */
  const wrappedPanelSegmentationWithTools = ({ configuration }) => {
    return (
      <>
        {/* AI 交互式分割工具箱，默认展开。 */}
        <Toolbox
          buttonSectionId="aiToolBox"
          // 交互式分割工具箱标题。
          title="交互式分割"
          defaultOpen={true}
        />

        {/* 文本提示分割工具箱，默认收起。 */}
        <Toolbox
          buttonSectionId="textPromptSegmentationToolbox"
          title="文本提示分割"
          defaultOpen={false}
        />

        {/* VLM（视觉语言模型）报告生成工具箱，默认收起。 */}
        <Toolbox
          buttonSectionId="testMedgemmaToolbox"
          title="VLM 报告生成"
          defaultOpen={false}
        />

        {/* 手动分割工具箱，默认收起。 */}
        <Toolbox
          buttonSectionId="segmentationToolbox"
          title="手动分割"
          defaultOpen={false}
        />

        {/* 分割结果列表和 Segment 管理功能。 */}
        <PanelSegmentation
          commandsManager={commandsManager}
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          configuration={{
            ...configuration,
          }}
        />
      </>
    );
  };

  /**
   * 返回当前 Cornerstone 扩展可以提供的所有面板模块。
   * PanelService 会读取这些模块，并根据 Mode 中提供的 namespace 找到对应组件。
   */
  return [
    {
      // 当前视口窗宽窗位的辅助面板，不显示为普通侧边栏 Tab。
      name: 'activeViewportWindowLevel',
      component: () => {
        return <ActiveViewportWindowLevel servicesManager={servicesManager} />;
      },
    },
    {
      // 普通测量面板。
      name: 'panelMeasurement',
      iconName: 'tab-linear',
      iconLabel: 'Measure',
      label: 'Measurement',
      component: PanelMeasurement,
    },
    {
      // 普通分割面板，不包含上方的 AI 和手动工具箱。
      name: 'panelSegmentation',
      iconName: 'tab-segmentation',
      iconLabel: 'Segmentation',
      label: 'Segmentation',
      component: wrappedPanelSegmentation,
    },
    {
      // 不带额外头部的分割面板。
      name: 'panelSegmentationNoHeader',
      iconName: 'tab-segmentation',
      iconLabel: 'Segmentation',
      label: 'Segmentation',
      component: wrappedPanelSegmentationNoHeader,
    },
    {
      /**
       * 基础查看器当前使用的分割面板。
       *
       * longitudinal Mode 中的配置：
       * rightPanels: [cornerstone.segmentation]
       *
       * cornerstone.segmentation 指向：
       * @ohif/extension-cornerstone.panelModule.panelSegmentationWithTools
       */
      name: 'panelSegmentationWithTools',
      iconName: 'tab-segmentation',
      // 右侧面板第一层 Tab 的图标辅助文本。
      iconLabel: '分割',
      // 右侧面板第一层 Tab 的显示标题。
      label: '分割',
      component: wrappedPanelSegmentationWithTools,
    },
  ];
};

export default getPanelModule;
