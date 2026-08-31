import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';

import { InvestigationalUseDialog } from '@ohif/ui-next';
import { HangingProtocolService, CommandsManager } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import { Onboarding, ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@ohif/ui-next';
import useResizablePanels from './ResizablePanelsHook';

// 左右面板与视口网格之间的可拖拽分隔条样式：浅色底、拖拽/悬停时显示主色提示。
const resizableHandleClassName =
  'mt-[1px] bg-border transition-colors duration-150 hover:bg-primary/50 data-[resize-handle-state=hover]:bg-primary/50';

/**
 * 查看器主页面布局组件。
 *
 * 承担页面整体的三栏结构编排：
 *
 *   ViewerLayout
 *   ├── ViewerHeader              顶部导航栏（返回、Logo、工具栏、患者信息、设置）
 *   └── ResizablePanelGroup       主体区（可拖拽调宽、可折叠）
 *       ├── 左侧面板（可折叠，显示序列列表等）
 *       ├── 视口网格（ViewportGrid，影像渲染区，恒为黑底）
 *       └── 右侧面板（可折叠，显示 AI 工具箱、分割表等）
 *
 * 职责：
 * 1. 订阅挂片协议 / 面板服务事件，响应式更新面板状态与加载指示器；
 * 2. 通过 useResizablePanels 管理左右面板的宽度、折叠与拖拽；
 * 3. 把扩展注册的视口组件（viewportComponents）交给 ViewportGridComp 渲染；
 * 4. 挂载新手引导（Onboarding）与研究用途声明（InvestigationalUseDialog）。
 */
function ViewerLayout({
  // From Extension Module Params
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  // From Modes
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
  leftPanelResizable = false,
  rightPanelResizable = false,
}: withAppTypes): React.FunctionComponent {
  // 从全局状态读取当前应用配置（路由、显示项、Logo 等）。
  const [appConfig] = useAppConfig();

  // 解构出布局用到的服务：面板服务、挂片协议服务和定制服务。
  const { panelService, hangingProtocolService, customizationService } = servicesManager.services;
  // 是否显示全局加载指示器（影像加载完成前展示）。
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);

  // 判断某一侧（left / right）是否注册了面板，用于决定该侧是否渲染。
  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  // 左右两侧是否分别存在面板（初始值来自服务注册结果）。
  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  // 左右面板是否处于折叠（收起）状态。
  const [leftPanelClosedState, setLeftPanelClosed] = useState(leftPanelClosed);
  const [rightPanelClosedState, setRightPanelClosed] = useState(rightPanelClosed);

  // 通过 Hook 统一得到面板的宽度、折叠、拖拽等相关 props，
  // 拆分出来是为了让本组件保持只负责"编排"而非"细节计算"。
  const [
    leftPanelProps,
    rightPanelProps,
    resizablePanelGroupProps,
    resizableLeftPanelProps,
    resizableViewportGridPanelProps,
    resizableRightPanelProps,
    onHandleDragging,
  ] = useResizablePanels(
    leftPanelClosed,
    setLeftPanelClosed,
    rightPanelClosed,
    setRightPanelClosed,
    hasLeftPanels,
    hasRightPanels
  );

  // 鼠标进入视口区域时移除当前焦点，避免键盘操作被残留焦点干扰。
  const handleMouseEnter = () => {
    (document.activeElement as HTMLElement)?.blur();
  };

  // 读取定制项：加载进度条组件（可通过 appConfig / customization 覆盖）。
  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  /**
   * 设置 body 类（tailwindcss）：禁止页面垂直/水平滚动，
   * 保证窗口尺寸即视口尺寸（全屏查看器体验）。
   */
  useEffect(() => {
    document.body.classList.add('bg-background');
    document.body.classList.add('overflow-hidden');

    return () => {
      document.body.classList.remove('bg-background');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  // 从扩展管理器中按"命名空间字符串"解析模块条目，用于动态加载视口组件。
  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);

    if (!entry || !entry.component) {
      throw new Error(
        `${id} is not valid for an extension module or no component found from extension ${id}. Please verify your configuration or ensure that the extension is properly registered. It's also possible that your mode is utilizing a module from an extension that hasn't been included in its dependencies (add the extension to the "extensionDependencies" array in your mode's index.js file). Check the reference string to the extension in your Mode configuration`
      );
    }

    return { entry };
  };

  // 订阅挂片协议变更事件：当协议应用完成后关闭加载指示器。
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      HangingProtocolService.EVENTS.PROTOCOL_CHANGED,

      // Todo: right now to set the loading indicator to false, we need to wait for the
      // hangingProtocolService to finish applying the viewport matching to each viewport,
      // however, this might not be the only approach to set the loading indicator to false. we need to explore this further.
      () => {
        setShowLoadingIndicator(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [hangingProtocolService]);

  // 把模式传入的视口配置映射为可渲染的视口数据（组件、是否可引用、要显示的显示集）。
  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  // 订阅面板服务的面板变更事件：动态同步左右面板的可见性与折叠状态。
  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(hasPanels('right'));
        if (options?.leftPanelClosed !== undefined) {
          setLeftPanelClosed(options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined) {
          setRightPanelClosed(options.rightPanelClosed);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [panelService, hasPanels]);

  // 将所有视口配置统一转换为渲染所需的数据结构。
  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div>
      {/* 顶部导航栏：返回、Logo、辅助工具栏、主工具栏、患者信息与设置菜单。 */}
      <ViewerHeader
        hotkeysManager={hotkeysManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={appConfig}
      />
      {/* 主体区：减去顶部导航栏高度，保证撑满剩余视口。 */}
      <div
        className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-background"
        style={{ height: 'calc(100vh - 52px)' }}
      >
        <React.Fragment>
          {/* 影像尚未就绪时显示全屏加载指示器。 */}
          {showLoadingIndicator && <LoadingIndicatorProgress className="h-full w-full bg-black" />}
          {/* 可拖拽调宽的弹性面板组：左面板 | 视口网格 | 右面板。 */}
          <ResizablePanelGroup {...resizablePanelGroupProps}>
            {/* 左侧面板（存在注册面板时渲染），可折叠、可拖拽调宽。 */}
            {hasLeftPanels ? (
              <>
                <ResizablePanel {...resizableLeftPanelProps}>
                  <SidePanelWithServices
                    side="left"
                    isExpanded={!leftPanelClosedState}
                    servicesManager={servicesManager}
                    {...leftPanelProps}
                  />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!leftPanelResizable}
                  className={resizableHandleClassName}
                />
              </>
            ) : null}
            {/* 中央视口网格：影像渲染区，恒为黑底（医学影像惯例）。 */}
            <ResizablePanel {...resizableViewportGridPanelProps}>
              <div className="flex h-full flex-1 flex-col">
                <div
                  className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-black"
                  onMouseEnter={handleMouseEnter}
                >
                  <ViewportGridComp
                    servicesManager={servicesManager}
                    viewportComponents={viewportComponents}
                    commandsManager={commandsManager}
                  />
                </div>
              </div>
            </ResizablePanel>
            {/* 右侧面板（存在注册面板时渲染），可折叠、可拖拽调宽。 */}
            {hasRightPanels ? (
              <>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!rightPanelResizable}
                  className={resizableHandleClassName}
                />
                <ResizablePanel {...resizableRightPanelProps}>
                  <SidePanelWithServices
                    side="right"
                    isExpanded={!rightPanelClosedState}
                    servicesManager={servicesManager}
                    {...rightPanelProps}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </React.Fragment>
      </div>
      {/* 底部浮层：新手引导（可配置）与研究用途声明弹窗。 */}
      <Onboarding tours={customizationService.getCustomization('ohif.tours')} />
      <InvestigationalUseDialog dialogConfiguration={appConfig?.investigationalUseDialog} />
    </div>
  );
}

ViewerLayout.propTypes = {
  // From extension module params
  extensionManager: PropTypes.shape({
    getModuleEntry: PropTypes.func.isRequired,
  }).isRequired,
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object.isRequired,
  // From modes
  leftPanels: PropTypes.array,
  rightPanels: PropTypes.array,
  leftPanelClosed: PropTypes.bool.isRequired,
  rightPanelClosed: PropTypes.bool.isRequired,
  /** Responsible for rendering our grid of viewports; provided by consuming application */
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
  viewports: PropTypes.array,
};

export default ViewerLayout;
