import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// 顶部 Header、按钮、图标和弹窗管理 Hook。
import { Button, Header, Icons, useModal } from '@ohif/ui-next';
// 从 OHIF 系统上下文中取得服务管理器、扩展管理器和命令管理器。
import { useSystem } from '@ohif/core';
// 通用工具栏组件，负责根据 buttonSection 渲染已注册的工具按钮。
import { Toolbar } from '../Toolbar/Toolbar';
// 顶部右侧的患者信息显示组件。
import HeaderPatientInfo from './HeaderPatientInfo';
// 患者信息的显示状态枚举。
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';
// 返回工作列表时保留 URL 中指定的查询参数。
import { preserveQueryParameters } from '@ohif/app';

/**
 * 查看器顶部区域的业务组装组件。
 *
 * ViewerHeader 不负责具体的三栏 CSS 布局，布局由 ui-next 中的 Header 组件完成。
 * 本组件的主要职责是：
 *
 * 1. 准备返回工作列表的逻辑；
 * 2. 创建关于、用户偏好和退出登录菜单；
 * 3. 组装辅助工具栏、主工具栏、患者信息和撤销/重做按钮；
 * 4. 将这些内容通过 props 传给通用 Header 组件。
 *
 * 页面顶部结构：
 *
 *   ViewerHeader
 *   └── Header
 *       ├── 左侧：返回按钮和 Logo
 *       ├── Secondary：辅助工具栏
 *       ├── children：主工具栏
 *       └── 右侧：撤销/重做、患者信息、设置菜单
 */
function ViewerHeader({ appConfig }: withAppTypes<{ appConfig: AppTypes.Config }>) {
  // 从 OHIF 全局系统上下文获取各项管理器。
  const { servicesManager, extensionManager, commandsManager } = useSystem();

  // customizationService 用来读取可被应用配置替换的 UI 组件。
  const { customizationService } = servicesManager.services;

  // 用于页面跳转和读取当前 URL。
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * 返回工作列表页面。
   *
   * 查看器 URL 可能包含数据源名称，例如：
   * /viewer/dicomweb?StudyInstanceUIDs=...
   *
   * 返回工作列表时，先识别当前数据源，再保留必要的查询参数，
   * 这样用户返回列表后仍然使用原来的数据源和筛选条件。
   */
  const onClickReturnButton = () => {
    // 当前页面路径，例如 /viewer/dicomweb。
    const { pathname } = location;

    // 从第二个路径片段开始查找数据源名称。
    const dataSourceIdx = pathname.indexOf('/', 1);

    // 截取数据源名称，例如 dicomweb。
    const dataSourceName = pathname.substring(dataSourceIdx + 1);

    // 确认该数据源是否已经由扩展注册。
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    // 准备返回工作列表时要携带的 URL 查询参数。
    const searchQuery = new URLSearchParams();

    // 如果当前路径包含有效数据源，则将其带回工作列表页面。
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }

    // 保留应用需要继续使用的其他查询参数。
    preserveQueryParameters(searchQuery);

    // 跳转到工作列表根路径。
    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  // 弹窗控制 Hook，用于显示关于和用户偏好弹窗。
  const { show } = useModal();

  // About 弹窗已停用，因此不再读取 AboutModal 配置。
  // const AboutModal = customizationService.getCustomization('ohif.aboutModal');
  const UserPreferencesModal = customizationService.getCustomization('ohif.userPreferencesModal');

  /**
   * 设置菜单选项。
   * 每个菜单项包含显示标题、图标名称和点击后的业务逻辑。
   */
  const menuOptions = [
    // About 菜单已注释，不在前端设置菜单中显示。
    // {
    //   // 关于菜单：打开 OHIF Viewer 说明弹窗。
    //   title: t('Header:About'),
    //   icon: 'info',
    //   onClick: () =>
    //     show({
    //       content: AboutModal,
    //       title: t('AboutModal:About OHIF Viewer'),
    //       containerClassName: 'max-w-md',
    //     }),
    // },
    {
      // 用户偏好菜单：打开用户设置弹窗。
      title: '偏好设置',
      icon: 'settings',
      onClick: () =>
        show({
          content: UserPreferencesModal,
          title: '用户偏好',
          containerClassName: 'flex max-w-4xl p-6 flex-col',
        }),
    },
  ];

  /**
   * 如果配置了 OIDC（OpenID Connect，身份认证协议），
   * 则在设置菜单中增加退出登录选项。
   */
  if (appConfig.oidc) {
    menuOptions.push({
      title: '退出登录',
      icon: 'power-off',
      onClick: async () => {
        // 退出后将当前页面地址作为重定向地址传给认证系统。
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  return (
    <Header
      // 设置菜单的配置项由上面的 menuOptions 动态生成。
      menuOptions={menuOptions}

      // 根据应用配置决定是否显示返回工作列表按钮。
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}

      // 如果配置了白标 Logo，则由 Header 使用自定义 Logo。
      WhiteLabeling={appConfig.whiteLabeling}

      /**
       * Secondary 是 Header 左侧偏中的辅助工具栏。
       * buttonSection="secondary" 表示只渲染 secondary 工具栏区域的按钮。
       */
      Secondary={
        <Toolbar
          servicesManager={servicesManager}
          buttonSection="secondary"
        />
      }

      /**
       * PatientInfo 是 Header 右侧的患者信息区域。
       * 当配置为 DISABLED 时不渲染该区域。
       */
      PatientInfo={
        appConfig.showPatientInfo !== PatientInfoVisibility.DISABLED && (
          <HeaderPatientInfo
            servicesManager={servicesManager}
            appConfig={appConfig}
          />
        )
      }

      /**
       * UndoRedo 是 Header 右侧的撤销/重做区域。
       * 具体命令由 commandsManager 统一执行，Header 只负责显示按钮。
       */
      UndoRedo={
        <div className="text-primary flex cursor-pointer items-center">
          {/* 点击后执行全局 undo 命令。 */}
          <Button
            variant="ghost"
            className="hover:bg-accent"
            onClick={() => {
              commandsManager.run('undo');
            }}
          >
            <Icons.Undo className="" />
          </Button>

          {/* 点击后执行全局 redo 命令。 */}
          <Button
            variant="ghost"
            className="hover:bg-accent"
            onClick={() => {
              commandsManager.run('redo');
            }}
          >
            <Icons.Redo className="" />
          </Button>
        </div>
      }
    >
      {/*
       * Header 的 children 会被放在顶部正中央。
       * 未显式指定 buttonSection 时，Toolbar 默认使用 primary 区域，
       * 因此这里是查看器顶部的主工具栏。
       */}
      <div className="relative flex justify-center gap-[4px]">
        <Toolbar servicesManager={servicesManager} />
      </div>
    </Header>
  );
}

export default ViewerHeader;
