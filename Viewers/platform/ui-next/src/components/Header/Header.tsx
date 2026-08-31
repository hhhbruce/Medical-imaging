import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

// 从 ui-next 组件目录统一导入下拉菜单、按钮和图标组件。
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Icons,
  Button,
} from '../';

// NavBar 是 Header 的最外层导航容器，负责顶部导航栏的基础样式和定位。
import NavBar from '../NavBar';

// TODO：后续可以将 Header 改造成更灵活的组合式组件，减少固定 props。

/**
 * 顶部导航栏接收的属性。
 *
 * 当前 Header 将页面顶部划分为几个可插入区域：
 *
 *   Header
 *   ├── 左侧：返回按钮和 Logo
 *   ├── 左侧偏中：Secondary 辅助工具栏
 *   ├── 正中央：children，通常是主工具栏
 *   └── 右侧：UndoRedo、PatientInfo、设置菜单
 */
interface HeaderProps {
  // 正中央显示的内容，ViewerHeader 中通常传入主 Toolbar。
  children?: ReactNode;

  // 设置菜单中的选项，例如关于、用户偏好和退出登录。
  menuOptions: Array<{
    title: string;
    icon?: string;
    onClick: () => void;
  }>;

  // 是否显示返回工作列表的按钮。
  isReturnEnabled?: boolean;

  // 点击返回按钮时执行的回调。
  onClickReturnButton?: () => void;

  // 是否将导航栏设置为粘性定位。
  isSticky?: boolean;

  // 白标配置。应用可以提供自定义 Logo，否则使用默认 OHIF Logo。
  WhiteLabeling?: {
    createLogoComponentFn?: (React: any, props: any) => ReactNode;
  };

  // 顶部右侧的患者信息组件。
  PatientInfo?: ReactNode;

  // 位于 Logo 右侧的辅助工具栏区域。
  Secondary?: ReactNode;

  // 顶部右侧的撤销/重做按钮区域。
  UndoRedo?: ReactNode;
}

/**
 * OHIF 查看器顶部导航栏。
 *
 * 这个组件主要负责顶部 UI 的空间布局，不直接负责具体业务功能。
 * 工具栏、患者信息和撤销/重做按钮都通过 props 传入，从而保持 Header 的通用性。
 */
function Header({
  // 中央主内容，通常是 primary Toolbar。
  children,
  // 设置菜单选项。
  menuOptions,
  // 默认允许返回工作列表。
  isReturnEnabled = true,
  onClickReturnButton,
  // 默认使用普通导航栏，而不是粘性导航栏。
  isSticky = false,
  // 应用自定义 Logo 配置。
  WhiteLabeling,
  // 右侧可插入区域。
  PatientInfo,
  UndoRedo,
  // Logo 和中央主工具栏之间的辅助工具栏。
  Secondary,
  // 其他属性继续传递给 NavBar。
  ...props
}: HeaderProps): ReactNode {
  /**
   * 返回工作列表。
   * 只有同时满足“返回功能已启用”和“调用方提供了回调”时才会执行。
   */
  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    // NavBar 是整个顶部区域的外层容器。
    <NavBar
      isSticky={isSticky}
      {...props}
    >
      {/* 固定高度为 48px 的 Header 内容区。 */}
      <div className="relative h-[48px] items-center">
        {/*
         * 左侧区域：
         * - isReturnEnabled 为 true 时显示返回箭头；
         * - 优先显示白标配置中的自定义 Logo；
         * - 没有自定义 Logo 时显示默认 OHIF Logo。
         */}
        <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center">
          <div
            className={classNames(
              'mr-3 inline-flex items-center',
              isReturnEnabled && 'cursor-pointer'
            )}
            onClick={onClickReturn}
            data-cy="return-to-work-list"
          >
            {isReturnEnabled && <Icons.ArrowLeft className="text-primary ml-1 h-7 w-7" />}
            <div className="ml-1">
              {WhiteLabeling?.createLogoComponentFn?.(React, props) || <Icons.OHIFLogo />}
            </div>
          </div>
        </div>

        {/*
         * Secondary 辅助工具栏。
         * left-[250px] 表示它从左侧 Logo 区域之后开始显示。
         */}
        <div className="absolute top-1/2 left-[250px] h-8 -translate-y-1/2">{Secondary}</div>

        {/*
         * 正中央区域：
         * children 通常是主工具栏，由绝对定位和 left-1/2 保持水平居中。
         */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform">
          <div className="flex items-center justify-center space-x-2">{children}</div>
        </div>

        {/*
         * 右侧区域，从右到左依次包含：
         * 1. 撤销/重做按钮；
         * 2. 患者信息；
         * 3. 设置下拉菜单。
         */}
        <div className="absolute right-0 top-1/2 flex -translate-y-1/2 select-none items-center">
          {/* 撤销和重做按钮由上层 ViewerHeader 传入。 */}
          {UndoRedo}

          {/* 撤销/重做与患者信息之间的分隔线。 */}
          <div className="mx-1.5 h-[25px] border-r border-border"></div>

          {/* 患者信息由 HeaderPatientInfo 组件传入。 */}
          {PatientInfo}

          {/* 患者信息与设置菜单之间的分隔线。 */}
          <div className="mx-1.5 h-[25px] border-r border-border"></div>

          {/* 设置菜单容器，防止按钮在弹性布局中被压缩。 */}
          <div className="flex-shrink-0">
            <DropdownMenu>
              {/* 齿轮按钮负责打开设置菜单。 */}
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-full w-full text-foreground/70 hover:bg-accent hover:text-primary"
                >
                  <Icons.GearSettings />
                </Button>
              </DropdownMenuTrigger>

              {/*
               * 菜单内容从 menuOptions 动态生成。
               * 每个选项可以有图标、标题和点击回调。
               */}
              <DropdownMenuContent align="end">
                {menuOptions.map((option, index) => {
                  // 根据字符串 icon 名称从 Icons 中取得实际图标组件。
                  const IconComponent = option.icon
                    ? Icons[option.icon as keyof typeof Icons]
                    : null;

                  return (
                    <DropdownMenuItem
                      key={index}
                      // 选择菜单项时执行该项自己的业务回调。
                      onSelect={option.onClick}
                      className="flex items-center gap-2 py-2"
                    >
                      {/* 只有配置了 icon 时才显示图标。 */}
                      {IconComponent && (
                        <span className="flex h-4 w-4 items-center justify-center">
                          <Icons.ByName name={IconComponent.name} />
                        </span>
                      )}

                      {/* 菜单标题占据剩余空间。 */}
                      <span className="flex-1">{option.title}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </NavBar>
  );
}

// 目前该组件的运行时属性校验由 TypeScript 的 HeaderProps 提供主要约束。
export default Header;
