# 前端设计思想

> 适用范围：`Viewers/`（基于 OHIF Viewer v3 的医学影像浏览器）
> 定位：本文档描述本项目前端整体的架构哲学、核心设计模式与最佳实践，供二次开发与定制参考。

---

## 1. 总体概览

本项目是一个**面向医学影像的 AI 交互平台**（OHIF-AI），在前端继承 OHIF Viewer 成熟架构的基础上，扩展出两条核心业务能力：

1. **AI 交互式分割**：视觉提示（点、涂鸦、套索、边界框）+ 文本提示，驱动 nnInteractive / SAM2 / MedSAM2 / SAM3 / VoxTell 等模型，支持实时推理、迭代修正与 3D 传播。
2. **AI 报告生成**：对接本地 MedGemma 或云端 VLM（Gemini / GPT / Claude / Kimi / Qwen / Gemma 4 / vLLM）。

**一句话概括设计哲学**：*"核心框架只提供能力注册与编排机制，一切业务能力以『扩展 + 模式』的形式按需组合"*。前端通过三个层次的解耦（平台层 / 扩展层 / 模式层），在保持核心稳定的同时，让 AI 能力像搭积木一样挂载进 DICOM 影像查看器。

---

## 2. 三层架构

### 2.1 平台层（platform）

平台层提供基础设施，**不含任何具体业务**：

| 包 | 职责 |
| --- | --- |
| `@ohif/core` | 核心运行时：扩展管理器、命令管理器、服务管理器、热键管理器，以及全部核心服务 |
| `@ohif/app` | 应用入口：`App.tsx` 装配 Provider、路由与初始化流程 |
| `@ohif/ui` | 旧版 UI 组件库（布局、表格、弹窗等） |
| `@ohif/ui-next` | 新版 UI 组件库（Radix UI + TailwindCSS），项目新功能主要使用 |
| `@ohif/i18n` | 国际化：`en` / `zh` 等语言包 |
| `@ohif/cli` | 命令行工具 |

### 2.2 扩展层（extensions）

扩展是**能力单元**，每个扩展按模块化接口暴露自身能力：

- `@ohif/extension-default`：默认 UI 与通用交互（工具栏、布局模板、面板、命令、快捷操作）
- `@ohif/extension-cornerstone`：影像渲染与标注（封装 `@cornerstonejs` v5 全家桶）
- `@ohif/extension-cornerstone-dicom-seg / -sr / -rt / -pmap`：DICOM 分割、结构化报告、放疗、参数图
- `@ohif/extension-dicom-video / -pdf / -microscopy`：视频、PDF、显微影像
- `@ohif/extension-monai-label`：MONAI Label 后端客户端（`MonaiLabelClient`）

每个扩展通过 `getXxxModule()` 接口暴露能力，例如 `extensions/default/src/index.ts` 中注册了：

```
getDataSourcesModule      数据源（DICOMweb 等）
getViewportModule         视口组件
getLayoutTemplateModule   布局模板
getPanelModule            侧边面板
getHangingProtocolModule  挂片协议
getSopClassHandlerModule  SOP 处理（如何把数据变成显示集）
getToolbarModule          工具栏按钮
getCommandsModule         命令集合
getCustomizationModule    定制项
getUtilityModule          通用工具函数
```

### 2.3 模式层（modes）

模式是**应用场景**，决定"当前页面长什么样、能做什么"。一个模式 = 一个路由 + 一套组合：

- `longitudinal`：纵向随访查看 + AI 分割 / 报告生成工具箱（本项目核心模式）
- `segmentation`：分割工作流
- `tmtv`：肿瘤代谢体积测量
- `basic-dev-mode / basic-test-mode`：开发 / 测试基座

模式在 `onModeEnter` 生命周期中装配 UI，典型流程（见 `modes/longitudinal/src/index.ts`）：

```ts
toolbarService.addButtons(toolbarButtons);                       // 1. 注册按钮
toolbarService.createButtonSection('primary', [...]);            // 2. 定义按钮分组
toolbarService.createButtonSection('aiToolBox', ['aiToolBoxContainer']); // 3. AI 工具箱分组
// ... 注册面板、视口、挂片协议、命令、快捷键
```

---

## 3. 核心设计模式

### 3.1 服务模式（Services）

**服务是可被任意层调用的单例运行时对象**，通过 `servicesManager.services` 统一访问。核心服务包括：

- `ToolBarService`：按钮注册与按钮分组（`addButtons` / `createButtonSection`）
- `PanelService`：左右侧面板的注册与可见性管理
- `HangingProtocolService`：挂片协议（影像如何摆放进视口）
- `ViewportGridService`：视口网格布局
- `DisplaySetService`：显示集（一组影像）管理
- `MeasurementService`：测量数据统一管理
- `SegmentationService`：分割数据管理（cornerstone 扩展内）
- `ToolGroupService`：工具组（把工具绑定到指定视口）
- `CustomizationService`：UI 定制项读取
- `UIDialogService / UIModalService / UIViewportDialogService / UINotificationService`：弹窗 / 模态框 / 视口内浮层 / 通知
- `UserAuthenticationService`：OIDC 登录
- `CineService`：Cine 播放

**服务间通过事件订阅解耦**。例如 `ViewerLayout` 订阅 `HangingProtocolService.EVENTS.PROTOCOL_CHANGED` 来关闭加载指示器，订阅 `PanelService.EVENTS.PANELS_CHANGED` 来响应面板增减。

### 3.2 命令模式（Commands）

**UI 不直接调用业务逻辑，而是通过命令 ID 触发**。工具栏按钮配置 `commandName` / `commandOptions`，点击后由 `CommandsManager` 路由到具体实现。

命令来源：

- 平台内置命令（`@ohif/core` 的 `CommandsManager`）
- 各扩展 `getCommandsModule` 提供的命令（如 `extensions/default/src/commandsModule.ts` 中 3700+ 行的命令集合）
- 模式内通过 `commandsManager.runCommand(...)` 动态执行

优点：按钮、快捷键、API 可以复用同一套命令；扩展可覆盖（override）已有命令实现。

### 3.3 扩展管理器（ExtensionManager）

- 通过**字符串 id 引用**模块，例如 `@ohif/extension-default.panelModule.seriesList`。
- 组件从"命名空间字符串"动态解析：`extensionManager.getModuleEntry(id)`。
- 因此模式中引用的所有组件都**按需加载**，扩展之间只通过约定好的 id 通信，互不 import。

### 3.4 定制模式（CustomizationService）

**不改代码即可改 UI**。`customizationService.getCustomization('xxx')` 读取定制项，例如：

- `ui.loadingIndicatorProgress`：加载进度条组件
- `ohif.tours`：新手引导流程
- 应用可在配置层注入自定义项，覆盖默认组件

### 3.5 状态管理模式

- **服务（Services）** 承载跨组件共享的**业务状态**与事件。
- **Zustand stores** 承载**纯 UI 状态**，例如 `extensions/default/src/stores/` 下的：
  - `useViewportGridStore`：视口网格
  - `useUIStateStore`：UI 状态
  - `useDisplaySetSelectorStore`：显示集选择
  - `useViewportsByPositionStore`：按位置记录视口
  - `toolboxState`：AI 工具箱状态（模型选择、Live 模式、VLM Provider 等）
- **React Context + Provider** 由 `App.tsx` 统一装配，通过 `Compose` 组合：
  `AppConfigProvider → UserAuthentication → I18next → Theme → System → ViewportGrid → ViewportDialog → Cine → Notification → Tooltip → Dialog → Modal → Shepherd`

模式切换时统一清理状态（`onModeExit` 清空各 store），保证进入新模式是干净环境。

### 3.6 Provider / Hook 分层

`@ohif/ui-next` 提供 `useSystem()` 等 Hook，让组件无需层层传 props 即可拿到 `servicesManager / commandsManager / extensionManager / hotkeysManager`。例如 `Toolbox.tsx` 中：

```ts
const { servicesManager, commandsManager, hotkeysManager } = useSystem();
```

### 3.7 通用工具箱组件（Toolbox）

`Toolbox` 是一个**通用容器组件**：给定 `buttonSectionId`，自动渲染该分组的按钮 + 工具设置。它不关心业务，只负责"把按钮和命令串起来"。本项目在此基础上实现了几类 AI 工具箱：

- `aiToolBox`：AI 分割工具箱（模型选择、Live 模式、正/负提示、锁定）
- `textPromptSegmentationToolbox`：文本提示分割
- `testMedgemmaToolbox`：MedGemma 报告生成测试

这套模式让 AI 面板与普通工具面板共用同一套渲染管线。

---

## 4. 页面装配流程（App 启动）

以 `platform/app/src/App.tsx` 为入口：

1. `appInit(config, defaultExtensions, defaultModes)` 异步初始化全部 Manager。
2. 读取 `appConfig`（路由基名、模式列表、数据源、OIDC、是否显示研究列表）。
3. 探测 WebGL2 能力并记录 `max3DTextureSize`（影响 3D 分割纹理上限）。
4. 组装 Provider 树（`Compose`）。
5. `createRoutes(...)` 根据模式与数据源生成路由。
6. 支持 OIDC 时包裹 `OpenIdConnectRoutes`。

页面主体由 `ViewerLayout`（`extensions/default/src/ViewerLayout/index.tsx`）承担：

```
+-------------------------- ViewerHeader --------------------------+
| 左面板(可折叠) |            视口网格区              | 右面板(可折叠) |
|  (面板服务)   |   ViewportGrid 视口网格（可缩放）    |  (面板服务)    |
+-------------------------- ResizablePanelGroup --------------------+
```

布局要点：

- 左右面板与视口网格基于 `ResizablePanelGroup` 可拖拽调宽，支持折叠。
- 视口数量、排列由挂片协议 + 视口网格服务共同决定。
- 加载时显示 `LoadingIndicatorProgress`，挂片协议应用完毕后关闭。
- 底部挂载 `Onboarding`（新手引导）与 `InvestigationalUseDialog`（研究用途声明）。

---

## 5. 数据流与渲染

### 5.1 从 DICOM 到屏幕

```
DICOM（DICOMweb / 本地 WADO）
   → DataSource 数据源
   → SopClassHandler 决定"这是什么类型"（图像 / SR / SEG / PDF / 视频）
   → DisplaySet 显示集（一组影像）
   → HangingProtocol 挂片协议（排布规则）
   → ViewportGrid 视口网格（渲染位置）
   → Cornerstone Viewport（@cornerstonejs 渲染）
```

### 5.2 测量 / 分割数据流

测量与分割通过 `MeasurementService` / `SegmentationService` 统一收口，跨视口同步、可持久化为 DICOM SR / SEG。

### 5.3 AI 推理数据流

```
用户在视口画提示（点 / 涂鸦 / 框）
   → 工具箱命令组装 infer 请求
   → MonaiLabelClient（extensions/monai-label）调用后端 /infer/{model}
   → 返回 DICOM-SEG（arraybuffer）
   → cornerstone 渲染分割结果（支持重叠分割层）
```

`MonaiLabelClient` 是薄客户端封装：`info / segmentation / deepgrow / infer / save_label / next_sample`，支持按 `studyInstanceUID` 关联病例。

---

## 6. UI 组件库设计

### 6.1 双组件库并存

- **`@ohif/ui`（旧）**：传统组件，服务于历史功能（研究列表、旧工具栏等）。
- **`@ohif/ui-next`（新）**：基于 **Radix UI 无头组件 + TailwindCSS + lucide 图标 + classnames/tailwind-merge** 构建，包含 80+ 组件（Dialog、Modal、DropdownMenu、Select、Slider、Tabs、SidePanel、ToolButton、CinePlayer、SegmentationTable 等）。

新功能（尤其 AI 相关）统一使用 `ui-next`，保证风格一致。

### 6.2 样式方案

- TailwindCSS 3（`ui-next` 内置 `tailwindcss: 3.2.4`）
- 全局深色主题：`ViewerLayout` 将 body 设为 `bg-black + overflow-hidden`，视口区恒为黑底（医学影像惯例）。
- 工具提示 / 弹出层统一走 Radix 原语，可访问性有保障。

### 6.3 国际化

`i18n` 平台包按命名空间组织（`Modes.json`、`Extensions` 等），模式与扩展通过 `useTranslation()` 读取翻译。中文语言包位于 `platform/i18n/src/locales/zh/`。

---

## 7. AI 能力的前端设计要点

### 7.1 提示交互与模型解耦

前端把"交互提示方式"与"底层模型"解耦：

- 提示方式（点 / 涂鸦 / 套索 / 框 / 文本）由 cornerstone 工具层负责采集。
- 模型选择（nnInteractive / SAM2 / MedSAM2 / SAM3 / VoxTell）由工具箱配置，运行时通过同一套 infer 通道转发。
- 这样新增模型只需后端注册 + 前端列表加一项，前端主体代码零改动。

### 7.2 实时与锁定

- **Live 模式**：每次提示自动触发推理。
- **锁定（Lock）**：锁定后禁用热键，防止误操作打断推理（`toolboxState.getLocked()`）。
- **Undo**：支持按交互步骤回退（nnInteractive）。

### 7.3 多用户并发

nnInteractive 支持多浏览器并发共享单 GPU：通过 **lease token + GPU 锁** 机制，每个客户端持独立会话（image、target buffer），互不污染。

### 7.4 VLM 报告生成

报告生成工具箱按 Provider 抽象：

- 本地：MedGemma（HF 权重，`device_map="auto"` 多卡）
- 云端：Gemini / GPT / Claude（各持 API Key）
- 路由：HuggingFace Router（Kimi / Qwen / Gemma 4）
- 自托管：OpenAI 兼容的 vLLM（InternVL / Qwen 等）

每个 Provider 有独立参数（thinking level、reasoning effort 等），统一写入 `toolboxState`，由前端发送给 MONAI 后端执行。

---

## 8. 约定与最佳实践

1. **一切皆注册，而非硬编码**：新面板 = `panelModule` 注册；新按钮 = `toolbarModule` / `createButtonSection`；新路由 = 新模式。不要往 `ViewerLayout` 里堆业务组件。
2. **跨扩展引用用 id 字符串**：`@ohif/extension-x.moduleType.moduleId`，不要直接 import 别的扩展内部文件。
3. **业务逻辑走命令**：组件只做渲染与事件转发，调用 `commandsManager.runCommand`。
4. **UI 状态进 Zustand store，业务状态进 Service**，事件通过 Service 订阅传递。
5. **新 UI 优先用 `@ohif/ui-next`**；样式用 Tailwind 工具类。
6. **国际化必须走 `useTranslation`**，文案不要写死。
7. **模式生命周期对称**：`onModeEnter` 注册的东西，`onModeExit` 要清理（state、订阅、临时 store）。
8. **配置优先**：能用 `customizationService` / `appConfig` 实现的需求，不要改代码。

---

## 9. 关键文件地图

| 文件 | 作用 |
| --- | --- |
| `platform/app/src/App.tsx` | 应用入口，装配 Provider 与路由 |
| `platform/app/src/appInit.js` | 初始化各 Manager |
| `extensions/default/src/index.ts` | 默认扩展的模块清单（能力注册范式） |
| `extensions/default/src/commandsModule.ts` | 默认扩展全部命令 |
| `extensions/default/src/ViewerLayout/index.tsx` | 主页面布局（Header + 侧栏 + 视口网格） |
| `extensions/default/src/utils/Toolbox.tsx` | 通用工具箱组件（AI 工具箱的底座） |
| `extensions/default/src/stores/toolboxState.ts` | AI 工具箱状态（模型 / VLM / Live / 锁定） |
| `extensions/monai-label/src/services/MonaiLabelClient.js` | MONAI Label 后端客户端 |
| `extensions/cornerstone/src/initCornerstoneTools.js` | cornerstone 工具初始化（含 AI 提示样式） |
| `modes/longitudinal/src/index.ts` | 核心模式：装配 AI 分割 + 报告生成 |
| `platform/ui-next/src/components/` | 新 UI 组件库 |
| `platform/i18n/src/locales/zh/` | 中文本地化 |
