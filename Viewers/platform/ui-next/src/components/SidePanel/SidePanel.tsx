import classnames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { Icons } from '../Icons';
import { TooltipTrigger, TooltipContent, Tooltip } from '../Tooltip';
import { Separator } from '../Separator';

/**
 * 侧边面板（SidePanel）组件。
 *
 * 这是查看器左右两侧可折叠、带 tab 切换的功能面板的**实际外观层**：
 * ViewerLayout 通过 SidePanelWithServices 封装后把面板数据（tabs）传入本组件渲染。
 *
 *   SidePanel（本组件）
 *   ├── 展开状态（panelOpen = true）
 *   │   ├── 顶部：tab 头部（单 tab 显示文字，多 tab 显示图标网格）+ 分隔线
 *   │   └── 内容区：当前激活 tab 的 content 组件
 *   └── 折叠状态（panelOpen = false）
 *       └── 仅显示窄条：展开箭头 + 各 tab 的图标（点击可直接打开对应 tab）
 *
 * 职责：
 * 1. 通过 margin 偏移实现"展开/折叠"，面板本体始终占 expandedWidth 宽度，
 *    折叠时把多余部分用负 margin 挤出屏幕（见 createStyleMap）；
 * 2. 维护面板展开状态与当前激活 tab（同时受外部 props 与内部点击驱动）；
 * 3. 根据 tab 数量自适应布局：<3 个 tab 时 tab 宽度 68px，否则 40px 并自动换行；
 * 4. 对外回调 onOpen / onClose / onActiveTabIndexChange 通知上层状态变化。
 *
 * 注意：组件会监听各种宽度与边框尺寸的变化并动态重算样式（见下方多个 useEffect）。
 */

/**
 * SidePanel 组件 props。
 * 组件会监听各宽度与边框尺寸的变化并动态调整布局。
 * @property {boolean} isExpanded - 面板是否处于展开（打开）状态；为 false 时折叠为窄条
 * @property {number} expandedWidth - 展开状态下面板的宽度（不含任何边框与外边距）
 * @property {number} collapsedWidth - 折叠状态下面板的宽度（不含任何边框与外边距）
 * @property {number} expandedInsideBorderSize - 展开面板与视口网格之间的空隙宽度
 * @property {number} collapsedInsideBorderSize - 折叠面板与视口网格之间的空隙宽度
 * @property {number} collapsedOutsideBorderSize - 折叠面板与浏览器窗口边缘之间的空隙宽度
 */
type SidePanelProps = {
  side: 'left' | 'right'; // 面板所在侧，决定图标方向、外边距偏移与滚动行为
  className: string; // 外部传入的附加样式类
  activeTabIndex: number; // 当前激活的 tab 下标（由外部控制时的受控值）
  onOpen: () => void; // 面板从折叠切换到展开时触发
  onClose: () => void; // 面板从展开切换到折叠时触发
  onActiveTabIndexChange: () => void; // 激活 tab 变化时触发（参数为 { activeTabIndex }）
  isExpanded: boolean; // 外部传入的展开状态（受控值，内部会同步）
  expandedWidth: number; // 展开宽度，默认 280px
  collapsedWidth: number; // 折叠宽度，默认 25px
  expandedInsideBorderSize: number; // 展开时与视口网格的间距，默认 4px
  collapsedInsideBorderSize: number; // 折叠时与视口网格的间距，默认 8px
  collapsedOutsideBorderSize: number; // 折叠时与浏览器窗口边缘的间距，默认 4px
  tabs: any; // 面板 tab 列表，每项含 { id, label, iconName, content, disabled, name } 等字段
};

/**
 * 样式映射表：面板在"展开/折叠" x "左侧/右侧" 四种组合下的外边距与对齐方式。
 * 面板本体宽度始终等于 expandedWidth，通过负 margin 把折叠后多余部分推出屏幕，
 * 因此折叠时屏幕上只露出 collapsedWidth 宽的窄条。
 */
type StyleMap = {
  open: {
    left: {
      marginLeft: string; // 展开时左面板与浏览器窗口左边缘的间距（0，紧贴窗口边缘）
      marginRight: string; // 展开时左面板与视口网格的间距
    };
    right: {
      marginLeft: string; // 展开时右面板与视口网格的间距
      marginRight: string; // 展开时右面板与浏览器窗口右边缘的间距（0，紧贴窗口边缘）
    };
  };
  closed: {
    left: {
      marginLeft: string; // 折叠时左面板与窗口左边缘的间距（负值，把面板主体推出屏幕左侧）
      marginRight: string; // 折叠时左面板与视口网格的间距
      alignItems: 'flex-end'; // flexbox 对齐方式：右对齐，让露出的窄条靠右
    };
    right: {
      marginLeft: string; // 折叠时右面板与视口网格的间距
      marginRight: string; // 折叠时右面板与窗口右边缘的间距（负值，把面板主体推出屏幕右侧）
      alignItems: 'flex-start'; // flexbox 对齐方式：左对齐，让露出的窄条靠左
    };
  };
};
// 折叠时露出的展开箭头（关闭图标）占用的固定宽度。
const closeIconWidth = 30;
// tab 头部网格与面板边缘之间的水平留白。
const gridHorizontalPadding = 10;
// 相邻两个 tab 之间的分隔条宽度。
const tabSpacerWidth = 2;

// 面板基础样式类：卡片底色、边框、纵向排列等。
const baseClasses = 'bg-card border-border justify-start box-content flex flex-col';

// 展开状态下用于"收起"的图标名，按所在侧区分方向。
const openStateIconName = {
  left: 'SidePanelCloseLeft',
  right: 'SidePanelCloseRight',
};

/** 根据 tab 数量决定单个 tab 的宽度：<3 个用 68px（宽），否则 40px（窄，便于多 tab 换行排列）。 */
const getTabWidth = (numTabs: number) => {
  if (numTabs < 3) {
    return 68;
  } else {
    return 40;
  }
};

/**
 * 计算 tab 头部网格的实际宽度：tab 总宽度 + 分隔条总宽度，
 * 但不超过可用宽度（gridAvailableWidth），空间不足时按可用宽度来。
 */
const getGridWidth = (numTabs: number, gridAvailableWidth: number) => {
  const spacersWidth = (numTabs - 1) * tabSpacerWidth;
  const tabsWidth = getTabWidth(numTabs) * numTabs;

  if (gridAvailableWidth > tabsWidth + spacersWidth) {
    return tabsWidth + spacersWidth;
  }

  return gridAvailableWidth;
};

/**
 * 计算 tab 网格每行能放几个 tab（列数）。
 * 先按"每个 tab 带一个分隔条"估算，再检查是否能再多放一个 tab（分隔条总比 tab 少一个）。
 */
const getNumGridColumns = (numTabs: number, gridWidth: number) => {
  if (numTabs === 1) {
    return 1;
  }

  // Start by calculating the number of tabs assuming each tab was accompanied by a spacer.
  const tabWidth = getTabWidth(numTabs);
  const numTabsWithOneSpacerEach = Math.floor(gridWidth / (tabWidth + tabSpacerWidth));

  // But there is always one less spacer than tabs, so now check if an extra tab with one less spacer fits.
  if (
    (numTabsWithOneSpacerEach + 1) * tabWidth + numTabsWithOneSpacerEach * tabSpacerWidth <=
    gridWidth
  ) {
    return numTabsWithOneSpacerEach + 1;
  }

  return numTabsWithOneSpacerEach;
};

/**
 * 计算单个 tab 按钮的样式类：高度/光标/悬停色，以及按列数决定首尾圆角。
 * 每行的第一个 tab 左圆角、最后一个 tab（或整行末位）右圆角。
 */
const getTabClassNames = (
  numColumns: number,
  numTabs: number,
  tabIndex: number,
  isActiveTab: boolean,
  isTabDisabled: boolean
) =>
  classnames('h-[28px] mb-[2px] cursor-pointer text-foreground bg-transparent transition-colors', {
    'hover:bg-accent/60 hover:text-primary': !isActiveTab && !isTabDisabled,
    'rounded-l': tabIndex % numColumns === 0,
    'rounded-r': (tabIndex + 1) % numColumns === 0 || tabIndex === numTabs - 1,
  });

/** 单个 tab 按钮的宽度样式。 */
const getTabStyle = (numTabs: number) => {
  return {
    width: `${getTabWidth(numTabs)}px`,
  };
};

/** 单个 tab 图标容器的样式类：激活时加主色半透明底与圆角。 */
const getTabIconClassNames = (numTabs: number, isActiveTab: boolean) => {
  return classnames('h-full w-full flex items-center justify-center', {
    'bg-primary/20': isActiveTab,
    rounded: isActiveTab,
  });
};

/**
 * 根据各宽度参数生成样式映射表（见 StyleMap 说明）。
 * collapsedHideWidth = 展开宽 - 折叠宽 - 窗口侧外边距：即折叠时需要用负 margin 藏起来的宽度。
 */
const createStyleMap = (
  expandedWidth: number,
  expandedInsideBorderSize: number,
  collapsedWidth: number,
  collapsedInsideBorderSize: number,
  collapsedOutsideBorderSize: number
): StyleMap => {
  const collapsedHideWidth = expandedWidth - collapsedWidth - collapsedOutsideBorderSize;

  return {
    open: {
      left: { marginLeft: '0px', marginRight: `${expandedInsideBorderSize}px` },
      right: { marginLeft: `${expandedInsideBorderSize}px`, marginRight: '0px' },
    },
    closed: {
      left: {
        marginLeft: `-${collapsedHideWidth}px`,
        marginRight: `${collapsedInsideBorderSize}px`,
        alignItems: `flex-end`,
      },
      right: {
        marginLeft: `${collapsedInsideBorderSize}px`,
        marginRight: `-${collapsedHideWidth}px`,
        alignItems: `flex-start`,
      },
    },
  };
};

/** 生成 tab 的 tooltip 内容；tab 被禁用时额外提示"当前上下文不可用"。 */
const getToolTipContent = (label: string, disabled: boolean) => {
  return (
    <>
      <div>{label}</div>
      {disabled && <div className="text-white">{'Not available based on current context'}</div>}
    </>
  );
};

/**
 * 生成面板的基础定位样式。
 * 为了让面板顶部与视口网格顶部对齐：使用 position relative，
 * 顶部偏移 0.2%，高度取 99.8%，避免内容溢出。
 */
const createBaseStyle = (expandedWidth: number) => {
  return {
    maxWidth: `${expandedWidth}px`,
    width: `${expandedWidth}px`,
    // To align the top of the side panel with the top of the viewport grid, use position relative and offset the
    // top by the same top offset as the viewport grid. Also adjust the height so that there is no overflow.
    position: 'relative',
    top: '0.2%',
    height: '99.8%',
  };
};

const SidePanel = ({
  side,
  className,
  activeTabIndex: activeTabIndexProp,
  isExpanded,
  tabs,
  onOpen,
  onClose,
  onActiveTabIndexChange,
  expandedWidth = 280,
  collapsedWidth = 25,
  expandedInsideBorderSize = 4,
  collapsedInsideBorderSize = 8,
  collapsedOutsideBorderSize = 4,
}: SidePanelProps) => {
  // 面板展开状态（与外部 isExpanded 同步，内部点击也可翻转）。
  const [panelOpen, setPanelOpen] = useState(isExpanded);
  // 当前激活的 tab 下标（受 activeTabIndexProp 控制，内部点击也可切换）。
  const [activeTabIndex, setActiveTabIndex] = useState(activeTabIndexProp ?? 0);

  // 展开/折叠的样式映射表（外边距、对齐方式），随尺寸 props 变化而重建。
  const [styleMap, setStyleMap] = useState(
    createStyleMap(
      expandedWidth,
      expandedInsideBorderSize,
      collapsedWidth,
      collapsedInsideBorderSize,
      collapsedOutsideBorderSize
    )
  );

  // 面板基础定位样式（固定宽度、相对定位、高度 99.8%）。
  const [baseStyle, setBaseStyle] = useState(createBaseStyle(expandedWidth));

  // tab 头部网格的可用宽度：面板宽减去关闭图标宽与水平留白。
  const [gridAvailableWidth, setGridAvailableWidth] = useState(
    expandedWidth - closeIconWidth - gridHorizontalPadding
  );

  // tab 头部网格的实际宽度（按 tab 数量与可用宽度计算）。
  const [gridWidth, setGridWidth] = useState(getGridWidth(tabs.length, gridAvailableWidth));
  // 当前面板状态标识：'open' / 'closed'，用于从 styleMap 中取值。
  const openStatus = panelOpen ? 'open' : 'closed';
  // 合并后的最终样式：对应状态与侧向的外边距 + 基础定位样式。
  const style = Object.assign({}, styleMap[openStatus][side], baseStyle);

  /**
   * 更新面板展开状态；状态发生实际变化时才触发 onOpen / onClose 事件。
   */
  const updatePanelOpen = useCallback(
    (isOpen: boolean) => {
      setPanelOpen(isOpen);
      if (isOpen !== panelOpen) {
        // only fire events for changes
        if (isOpen && onOpen) {
          onOpen();
        } else if (onClose && !isOpen) {
          onClose();
        }
      }
    },
    [panelOpen, onOpen, onClose]
  );

  /**
   * 更新激活 tab 下标；forceOpen 为 true 时同时展开面板（用于折叠状态点 tab 图标直接打开）。
   * 切换后调用 onActiveTabIndexChange 通知外部。
   */
  const updateActiveTabIndex = useCallback(
    (activeTabIndex: number, forceOpen: boolean = false) => {
      if (forceOpen) {
        updatePanelOpen(true);
      }

      setActiveTabIndex(activeTabIndex);

      if (onActiveTabIndexChange) {
        onActiveTabIndexChange({ activeTabIndex });
      }
    },
    [onActiveTabIndexChange, updatePanelOpen]
  );

  // 外部 isExpanded 变化时同步内部展开状态。
  useEffect(() => {
    updatePanelOpen(isExpanded);
  }, [isExpanded, updatePanelOpen]);

  // 尺寸相关 props 或 tab 数量变化时，重建样式映射表、基础样式与 tab 网格宽度。
  useEffect(() => {
    setStyleMap(
      createStyleMap(
        expandedWidth,
        expandedInsideBorderSize,
        collapsedWidth,
        collapsedInsideBorderSize,
        collapsedOutsideBorderSize
      )
    );
    setBaseStyle(createBaseStyle(expandedWidth));

    const gridAvailableWidth = expandedWidth - closeIconWidth - gridHorizontalPadding;
    setGridAvailableWidth(gridAvailableWidth);
    setGridWidth(getGridWidth(tabs.length, gridAvailableWidth));
  }, [
    collapsedInsideBorderSize,
    collapsedWidth,
    expandedWidth,
    expandedInsideBorderSize,
    tabs.length,
    collapsedOutsideBorderSize,
  ]);

  // 外部 activeTabIndexProp 变化时同步激活 tab。
  useEffect(() => {
    updateActiveTabIndex(activeTabIndexProp ?? 0);
  }, [activeTabIndexProp, updateActiveTabIndex]);

  /**
   * 折叠状态下的窄条内容：上方一个"展开箭头"按钮 + 下方各 tab 的图标。
   * 点击箭头切换展开状态；点击某个 tab 图标则直接打开对应 tab。
   */
  const getCloseStateComponent = () => {
    const _childComponents = Array.isArray(tabs) ? tabs : [tabs];
    return (
      <>
        <div
          className={classnames(
            'bg-secondary hover:bg-accent flex h-[28px] w-full cursor-pointer items-center rounded-md transition-colors',
            side === 'left' ? 'justify-end pr-2' : 'justify-start pl-2'
          )}
          onClick={() => {
            updatePanelOpen(!panelOpen);
          }}
          data-cy={`side-panel-header-${side}`}
        >
          <Icons.NavigationPanelReveal
            className={classnames('text-primary', side === 'left' && 'rotate-180 transform')}
          />
        </div>
        <div className={classnames('mt-3 flex flex-col space-y-3')}>
          {_childComponents.map((childComponent, index) => (
            <Tooltip key={index}>
              <TooltipTrigger>
                <div
                  id={`${childComponent.name}-btn`}
                  data-cy={`${childComponent.name}-btn`}
                  className="text-primary hover:text-primary/80 flex items-center rounded-md p-1 transition-colors hover:bg-accent/70"
                  onClick={() => {
                    return childComponent.disabled ? null : updateActiveTabIndex(index, true);
                  }}
                >
                  {React.createElement(Icons[childComponent.iconName] || Icons.MissingIcon, {
                    className: classnames({
                      'text-primary': true,
                      'ohif-disabled': childComponent.disabled,
                    }),
                    style: {
                      width: '22px',
                      height: '22px',
                    },
                  })}
                </div>
              </TooltipTrigger>
              <TooltipContent side={side === 'left' ? 'right' : 'left'}>
                <div
                  className={classnames(
                    'flex items-center',
                    side === 'left' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {getToolTipContent(childComponent.label, childComponent.disabled)}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </>
    );
  };

  /**
   * 展开状态下头部右上/左上角的"收起"图标：绝对定位于面板内侧，点击切换折叠。
   */
  const getCloseIcon = () => {
    return (
      <div
        className={classnames(
          'absolute flex cursor-pointer items-center justify-center',
          side === 'left' ? 'right-0' : 'left-0'
        )}
        style={{ width: `${closeIconWidth}px` }}
        onClick={() => {
          updatePanelOpen(!panelOpen);
        }}
        data-cy={`side-panel-header-${side}`}
      >
        {React.createElement(Icons[openStateIconName[side]] || Icons.MissingIcon, {
          className: 'text-primary',
        })}
      </div>
    );
  };

  /**
   * 展开状态下"多 tab"的头部：收起图标 + 自适应换行的 tab 图标网格。
   * tab 之间插入 2px 分隔条；激活 tab 带主色底；禁用 tab 点击无效并显示 tooltip 提示。
   */
  const getTabGridComponent = () => {
    const numCols = getNumGridColumns(tabs.length, gridWidth);

    return (
      <>
        {getCloseIcon()}
        <div className={classnames('flex grow justify-center')}>
          <div className={classnames('bg-accent/60 text-primary flex flex-wrap rounded-md')}>
            {tabs.map((tab, tabIndex) => {
              const { disabled } = tab;
              return (
                <React.Fragment key={tabIndex}>
                  {/* 非每行第一个 tab 前插入竖向分隔条 */}
                  {tabIndex % numCols !== 0 && (
                    <div
                      className={classnames(
                        'flex h-[28px] w-[2px] items-center bg-transparent',
                        tabSpacerWidth
                      )}
                    >
                      <div className="bg-primary/20 h-[20px] w-full"></div>
                    </div>
                  )}
                  <Tooltip key={tabIndex}>
                    <TooltipTrigger>
                      <div
                        className={classnames(
                          getTabClassNames(
                            numCols,
                            tabs.length,
                            tabIndex,
                            tabIndex === activeTabIndex,
                            disabled
                          ),
                          'transition-colors'
                        )}
                        style={getTabStyle(tabs.length)}
                        onClick={() => {
                          return disabled ? null : updateActiveTabIndex(tabIndex);
                        }}
                        data-cy={`${tab.name}-btn`}
                      >
                        <div
                          className={getTabIconClassNames(tabs.length, tabIndex === activeTabIndex)}
                        >
                          {React.createElement(Icons[tab.iconName] || Icons.MissingIcon, {
                            className: classnames({
                              'text-primary': true,
                              'ohif-disabled': disabled,
                            }),
                            style: {
                              width: '22px',
                              height: '22px',
                            },
                          })}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {getToolTipContent(tab.label, disabled)}
                    </TooltipContent>
                  </Tooltip>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  /**
   * 展开状态下"单 tab"的头部：点击整行（或收起图标）即可切换展开/折叠，直接显示 tab 标签文字。
   */
  const getOneTabComponent = () => {
    return (
      <div
        className={classnames(
          'text-primary flex grow cursor-pointer select-none justify-center self-center text-[13px]'
        )}
        data-cy={`${tabs[0].name}-btn`}
        onClick={() => updatePanelOpen(!panelOpen)}
      >
        {getCloseIcon()}
        <span>{tabs[0].label}</span>
      </div>
    );
  };

  /**
   * 展开状态下的头部容器：40px 高的圆角顶栏 + 横向分隔线。
   * 内部按 tab 数量选择"单 tab 文字"或"多 tab 图标网格"。
   */
  const getOpenStateComponent = () => {
    return (
      <>
        <div className="bg-bkg-med flex h-[40px] flex-shrink-0 select-none rounded-t p-2">
          {tabs.length === 1 ? getOneTabComponent() : getTabGridComponent()}
        </div>
        <Separator
          orientation="horizontal"
          className="bg-border"
          thickness="2px"
        />
      </>
    );
  };

  return (
    <div
      className={classnames(className, baseClasses)}
      style={style}
    >
      {panelOpen ? (
        <>
          {/* 展开状态：头部 + 当前激活 tab 的内容区（右侧面板可滚动，左侧固定） */}
          {getOpenStateComponent()}
          <div 
            className={classnames(
              "flex flex-col overflow-x-hidden flex-1 min-h-0",
              side === 'right' ? "overflow-y-auto side-panel-scrollable" : "overflow-hidden"
            )} 
          >
          {/* 只渲染当前激活的 tab.content 组件 */}
          {tabs.map((tab, tabIndex) => {
            if (tabIndex === activeTabIndex) {
              return <tab.content key={tabIndex} />;
            }
            return null;
          })}
          </div>
        </>
      ) : (
        /* 折叠状态：窄条（展开箭头 + tab 图标） */
        <React.Fragment>{getCloseStateComponent()}</React.Fragment>
      )}
    </div>
  );
};

export { SidePanel };
