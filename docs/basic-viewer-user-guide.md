# 基础查看器使用手册

本文适用于本项目的 **基础查看器（Basic Viewer）**，即 `longitudinal` 模式。它覆盖当前页面中实际启用的阅片、测量、手工分割、AI 交互分割和导出功能。

> 本系统当前用于开发、科研和功能验证，不应直接用于临床诊断。

## 1. 使用前准备

进入查看器前，应确认以下服务可用：

1. Orthanc：存储并提供 DICOM/DICOMWeb 数据。
2. MONAI Label：提供 nnInteractive、SAM2、MedSAM2、SAM3 等推理服务。
3. OHIF 前端：提供基础查看器页面。

启动方式见 [`backstart.md`](./backstart.md)。

建议先使用项目自带的 CT 样例：

```text
D:\Smart City\Medical-imaging\sample-data\2.000000-PRE LIVER-76970.zip
```

解压后只上传真实的 43 个 `.dcm` 文件，不要上传 `__MACOSX` 目录中的文件。

## 2. 页面区域

基础查看器由四个主要区域组成：

| 区域 | 作用 |
| --- | --- |
| 左侧序列栏 | 显示当前检查中的序列缩略图，可将序列拖入视口 |
| 中央视口 | 显示 CT、MR、US 等影像，执行浏览、测量和标注 |
| 顶部工具栏 | 窗宽窗位、缩放、平移、布局、测量、截图等通用工具 |
| 右侧分割面板 | AI 交互分割、文本提示分割、手工分割、分割列表和导出 |

中央视口带高亮边框时表示它是**活动视口**。顶部工具和右侧分割操作通常作用于当前活动视口。

### 2.1 默认鼠标操作

未主动切换工具时，默认操作如下：

| 操作 | 功能 |
| --- | --- |
| 鼠标左键拖动 | 调整窗宽/窗位 |
| 鼠标中键拖动 | 平移影像 |
| 鼠标右键拖动 | 缩放影像 |
| 鼠标滚轮 | 前后切换切片 |
| 双击视口 | 在单视口放大与原布局之间切换 |
| 在标注附近单击右键 | 打开标注上下文菜单 |

## 3. 推荐的基本阅片流程

1. 从检查列表进入 **基础查看器**。
2. 在左侧确认序列名称、模态和层数。
3. 单击序列，或将序列拖到中央视口。
4. 使用滚轮浏览全部切片，确认影像加载完整。
5. 使用窗宽窗位或快捷键 `1`～`4` 选择 CT 预设。
6. 需要多序列比较时，使用 `Layout` 调整布局，再将不同序列拖入对应视口。
7. 完成测量或分割后，使用右侧分割菜单导出结果。

## 4. 顶部常用工具

| 工具 | 用途 | 使用方式 |
| --- | --- | --- |
| Measurement Tools | 打开测量工具列表 | 选择一种测量后，在影像上单击或拖动 |
| Zoom | 缩放 | 左键上下拖动；也可使用 `+`、`-` |
| Pan | 平移 | 左键拖动 |
| 3D Rotate | 旋转三维视图 | 仅在 3D 视口可用 |
| Window Level | 调整窗宽窗位 | 左键拖动，通常左右改变窗宽、上下改变窗位 |
| Capture | 截取活动视口 | 打开下载窗口并保存当前视口图像 |
| Layout | 设置视口布局 | 可选择最多 3 行 × 4 列布局 |
| Crosshairs | MPR 十字线定位 | 只在 MPR 视口可用 |
| More Tools | 打开更多阅片工具 | 包含重置、旋转、反色、电影播放等 |

### 4.1 窗宽窗位预设

CT 影像可以直接使用以下快捷键：

| 快捷键 | 预设 |
| --- | --- |
| `1` | 软组织窗 |
| `2` | 肺窗 |
| `3` | 骨窗 |
| `4` | 脑窗 |
| `Space` | 重置视口显示 |

## 5. 测量和普通标注工具

普通测量只生成测量标注，不会调用 AI，也不会自动生成器官分割。

| 工具 | 用途 | 操作方法 |
| --- | --- | --- |
| Length | 长度 | 依次单击起点和终点 |
| Bidirectional | 双径测量 | 绘制长径，再绘制与其垂直的短径 |
| Annotation | 箭头文字标注 | 单击目标位置并输入说明 |
| Ellipse | 椭圆 ROI | 拖动创建椭圆区域，显示面积和统计值 |
| Rectangle | 矩形 ROI | 拖动创建矩形区域，显示面积和统计值 |
| Circle | 圆形 ROI | 从中心向外拖动创建圆形区域 |
| Freehand ROI | 自由手 ROI | 按住左键沿边缘描绘并闭合轮廓 |
| Spline ROI | 样条 ROI | 连续放置控制点形成平滑轮廓 |
| Livewire | 智能边缘轮廓 | 沿目标边缘放置控制点，由工具吸附边界 |
| Probe | 像素探针 | 单击查看该位置的像素/体素值 |
| Angle | 角度 | 用三点定义一个夹角 |
| Cobb Angle | Cobb 角 | 绘制两条参考线计算夹角 |
| Calibration | 标定 | 用已知长度校正图像距离比例 |

### 5.1 删除和取消标注

- 绘制过程中按 `Esc` 取消。
- 选中已有标注后按 `Backspace` 删除。
- `Ctrl+Shift+Z` 撤销普通编辑。
- `Ctrl+Y` 重做普通编辑。

## 6. More Tools 工具说明

| 工具 | 用途 |
| --- | --- |
| Reset View | 恢复初始缩放、平移、旋转和窗宽窗位 |
| Rotate Right | 顺时针旋转 90° |
| Flip Horizontal | 水平翻转影像 |
| Image Slice Sync | 同步多个堆栈视口的空间位置 |
| Reference Lines | 在关联视口中显示参考线 |
| Image Overlay | 显示或隐藏 DICOM 叠加信息 |
| Stack Scroll | 将鼠标拖动行为切换为切片滚动 |
| Invert | 黑白反相 |
| Probe | 查看像素值 |
| Cine | 连续播放切片 |
| Magnify | 局部放大 |
| Magnify Probe | 可移动的放大镜 |
| DICOM Tag Browser | 查看当前影像的 DICOM 标签 |
| Window Level Region | 根据指定区域调整窗宽窗位 |
| Ultrasound Directional | 超声方向测量，仅 US 模态可用 |

## 7. 右侧分割面板

右侧面板从上到下包含：

1. **Interactive Segmentation (OHIF-AI)**：点、涂鸦、套索、BBox 和 AI 推理。
2. **Text-Prompt Segmentation**：使用器官名称等文本执行分割。
3. **VLM Report Generation**：实验性的视觉语言模型分析。
4. **Manual Segmentation**：画笔、擦除、阈值、形状和插值。
5. **Segmentations**：分割及其 Segment 的管理、显示、统计和导出。

## 8. AI 交互分割

### 8.1 AI 工具箱开关

| 控件 | 含义 |
| --- | --- |
| Live Mode `[Q]` | 开启后，每新增一个 AI 提示都会自动运行当前模型；关闭后需手动点 `run segmentation` |
| Pos/Neg `[T]` | 关闭为正向提示（包含目标），开启为负向提示（排除区域） |
| Model | 选择 `nnInteractive`、`SAM2`、`MedSAM2` 或 `SAM3` |
| 锁图标 | 锁定后关闭 Live Mode、禁用 AI 工具，并切换到 Pan，防止误操作 |

默认状态：

- 模型：`nnInteractive`
- Live Mode：开启
- Pos/Neg：关闭，即正向提示
- 推理后提示标记：默认隐藏

首次操作建议先关闭 Live Mode。这样可以一次放置多个正向/负向提示，确认无误后再手动运行，避免每画一次就触发一次推理。

### 8.2 AI 提示工具

| 工具 | 快捷键 | 用途 |
| --- | --- | --- |
| Point | `P` | 在目标内部或需要排除的位置放置单点 |
| Scribble | `S` | 在目标内部或错误区域连续涂画提示线 |
| Lasso | `L` | 用闭合轮廓限定目标区域 |
| BBox | `B` | 用矩形框限定目标范围；当前版本存在已知故障，暂不使用 |
| run segmentation | 无 | Live Mode 关闭时手动运行当前模型 |
| Undo | `Ctrl+Z` | 撤销上一次 nnInteractive 推理结果 |

### 8.3 使用 nnInteractive 分割一个器官

推荐流程：

1. 在右侧模型选择中选择 `nnInteractive`。
2. 关闭 `Live Mode`。
3. 确认 `Pos/Neg` 为关闭状态。
4. 按 `P` 选择 Point，在器官内部放置一个或多个正向点。
5. 如需增强范围提示，可按 `S` 在器官内部涂画，或按 `L` 圈出器官。
6. 如果提示包含了不需要的组织，按 `T` 切换到负向模式。
7. 在错误区域放置负向点或负向涂鸦。
8. 再按 `T` 回到正向模式，避免后续提示方向错误。
9. 点击 `run segmentation`。
10. 等待 `Run Segmentation - Successful`，检查视口中的分割覆盖层。
11. 如结果不完整，继续增加正向提示后再次运行。
12. 如结果越界，在越界区域增加负向提示后再次运行。

### 8.4 实时修正

如果希望每次提示后立即看到结果：

1. 开启 `Live Mode`。
2. 放置正向或负向提示。
3. 每个提示完成后，系统自动运行当前模型。
4. 上一次推理尚未完成时，新操作会排队，不需要连续点击运行按钮。

体积较大或显存有限时，建议关闭 Live Mode，减少重复推理。

### 8.5 多器官分割

每个器官应使用独立 Segment：

1. 完成第一个器官分割。
2. 点击右侧 `Add Segment`，或按 `M`。
3. 确认新 Segment 已成为活动项。
4. Pos/Neg 会回到正向模式。
5. 对第二个器官重新放置提示并运行分割。
6. 单击 Segment 名称可以重新激活并定位对应器官。

不要把多个器官的提示混在同一个 Segment 中，除非确实希望它们作为一个标签导出。

### 8.6 修正现有 Segment

1. 在 `Segmentations` 列表中单击需要修正的 Segment。
2. 确认该 Segment 可见且处于活动状态。
3. 添加正向提示补充分割，或添加负向提示移除误分区域。
4. 运行分割。
5. 使用 `Ctrl+Z` 撤销最近一次 nnInteractive 结果。
6. 使用 `Reset Segment [R]` 清空当前 Segment 后重新开始。

隐藏的 Segment 不允许继续细化；先点击眼睛图标恢复显示。

### 8.7 提示的显示与隐藏

AI 推理后，Point、Scribble、Lasso、BBox 默认会隐藏，以免遮挡分割结果。

- 按 `O` 切换显示/隐藏全部 AI 提示。
- 也可点击 `Show Prompts` / `Hide Prompts`。
- 隐藏某个 Segment 时，该 Segment 的提示也会一起隐藏。

## 9. 模型选择说明

| 模型 | 适合的提示 | 使用条件 |
| --- | --- | --- |
| nnInteractive | 正负点、涂鸦、套索、BBox、文本 | 后端必须加载 nnInteractive 模型并有可用会话 |
| SAM2 | 正负点、BBox | 后端必须加载 SAM2；当前启动配置为 `lazy` 时首次使用可能较慢 |
| MedSAM2 | 正负点、BBox | 后端必须加载 MedSAM2；适合医学影像交互分割 |
| SAM3 | 当前前端按 SAM2 类模型路径调用 | 后端必须加载 SAM3，并支持当前请求格式 |

当前 BBox 前端故障会影响依赖 BBox 的所有模型。故障修复前优先使用 Point；nnInteractive 还可以使用 Scribble 和 Lasso。

## 10. 文本提示分割

`Text-Prompt Segmentation` 会打开输入框，可输入目标器官或结构，例如：

```text
liver
left kidney
spleen
```

操作步骤：

1. 展开 `Text-Prompt Segmentation`。
2. 选择 Replace/New 模式。
3. 点击 `Text Prompt`。
4. 输入英文器官名称并按 Enter。
5. 等待后端返回结果。

Replace/New 的实际含义：

- 关闭：对当前活动 Segment 进行替换或细化。
- 开启：创建或填充一个新的 Segment。

文本提示依赖后端对应模型能力。普通 nnInteractive 权重不一定支持任意文本，若后端未加载 VoxTell/文本模型，输入文本不会产生有效结果。

## 11. 手工分割

使用手工工具前，需要先存在一个 Segmentation 和活动 Segment。可通过 AI 结果创建，也可在分割面板菜单中选择 `Create New Segmentation`，再点击 `Add Segment`。

### 11.1 Brush

- `Circle`：只编辑当前切片，适合逐层修正。
- `Sphere`：编辑三维球形范围，可能同时影响相邻切片。
- Radius：范围为 `0.5`～`99.5 mm`。
- 快捷键 `Ctrl+B` 激活圆形画笔。
- `[` 缩小画笔，`]` 放大画笔。

### 11.2 Eraser

- `Circle`：擦除当前切片上的分割。
- `Sphere`：擦除三维范围。
- 快捷键 `E` 激活圆形橡皮擦。
- 擦除前确认活动 Segment 正确，避免修改其他器官。

### 11.3 Threshold Tool

阈值工具只填充分布在指定灰度范围内的体素。

| 模式 | 含义 |
| --- | --- |
| Dynamic | 根据落笔位置附近的灰度动态估计阈值 |
| Range | 手动指定阈值范围，当前界面范围为 `-1000`～`1000` |
| Circle | 只处理当前切片圆形区域 |
| Sphere | 处理三维球形区域 |

CT 中阈值值通常对应 HU。使用 Range 前应先用 Probe 确认目标组织的灰度范围。

### 11.4 Shapes

| 形状 | 用途 |
| --- | --- |
| Circle | 在当前切片填充圆形区域 |
| Sphere | 填充三维球形区域 |
| Rectangle | 在当前切片填充矩形区域 |

### 11.5 Interpolate Labelmap

用于在已标注切片之间自动补齐中间切片：

1. 在同一个 Segment 的第一张切片绘制区域。
2. 滚动到另一张非相邻切片，绘制同一目标区域。
3. 点击 `Interpolate Labelmap`。
4. 检查中间切片的插值结果。
5. 使用 Brush 或 Eraser 修正不准确部分。

要求影像体积可重建，且至少有两张切片包含有效标注。

### 11.6 Segment Bidirectional

自动查找活动 Segment 跨切片的最大长径和短径，并显示双径测量。应在分割基本完成后使用。

### 11.7 手工分割设置

点击 `Manual Segmentation` 标题旁的设置图标可以调整：

| 设置 | 作用 |
| --- | --- |
| Preview edits before creating | 提交前预览编辑结果 |
| Use center as segment index | 使用中心位置决定 Segment |
| Hover on segment border to activate | 鼠标悬停在边界时自动激活对应 Segment |

## 12. 分割列表管理

`Segmentations` 区域用于管理分割集合和其中的 Segment。

### 12.1 Segment 操作

| 操作 | 作用 |
| --- | --- |
| 单击 Segment | 激活该 Segment，并将视口定位到对应区域 |
| Add Segment `[M]` | 新增一个器官/标签 |
| Reset Segment `[R]` | 清空活动 Segment，保留 Segment 项 |
| 眼睛图标 | 显示或隐藏 Segment |
| 锁图标 | 锁定 Segment，避免手工修改 |
| 颜色 | 修改覆盖层颜色 |
| 名称编辑 | 修改器官名称 |
| 删除 | 删除 Segment 及其关联 AI 提示 |

### 12.2 Segmentation 操作

打开 Segmentation 的菜单可以：

- 新建 Segmentation。
- 从当前视口移除。
- 重命名。
- 下载 CSV 统计报告。
- 下载 DICOM SEG。
- 下载 DICOM RTSS。
- 将 DICOM SEG 写回配置的数据源。
- 删除整个 Segmentation。

DICOM SEG 和 RTSS 只对可重建影像开放。如果按钮为灰色，应先确认原始序列包含完整空间信息并可构建体积。

### 12.3 结果保存

分割结果默认主要保存在浏览器运行状态中。完成分割后应及时：

1. 下载 DICOM SEG；或
2. 使用 Export → DICOM SEG 写回数据源；并
3. 按需下载 CSV 报告。

关闭页面前未导出的结果不应视为已持久化保存。

## 13. 快捷键速查

### 13.1 AI 分割快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Q` | 开关 Live Mode |
| `T` | 切换正向/负向提示 |
| `P` | Point |
| `B` | BBox，当前版本暂不可用 |
| `S` | Scribble |
| `L` | Lasso |
| `M` | Add Segment |
| `R` | Reset 当前 Segment |
| `O` | 显示/隐藏 AI 提示 |
| `Ctrl+Z` | 撤销最近一次 nnInteractive 推理 |
| `Delete` | 删除活动 Segment |
| `G` | 重置 nnInteractive 会话 |

当 AI 工具箱锁定时，这些快捷键被禁用。

### 13.2 阅片快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Z` | 激活缩放工具 |
| `+` / `-` | 放大/缩小 |
| `=` | 适配窗口 |
| `Space` | 重置视口 |
| `↑` / `↓` | 上一张/下一张切片 |
| `Home` / `End` | 第一张/最后一张切片 |
| `←` / `→` | 上一个/下一个活动视口 |
| `PageUp` / `PageDown` | 上一个/下一个序列 |
| `C` | 开关 Cine |
| `I` | 反色 |
| `H` | 水平翻转 |
| `Ctrl+R` | 顺时针旋转 |
| `Ctrl+L` | 逆时针旋转 |
| `V` | 显示/隐藏所有视口中的分割 |
| `1`～`4` | CT 窗宽窗位预设 |

### 13.3 手工分割和编辑快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+B` | 圆形 Brush |
| `E` | 圆形 Eraser |
| `[` / `]` | 缩小/放大画笔 |
| `Backspace` | 删除选中的普通标注 |
| `Ctrl+Shift+Z` | 撤销普通编辑 |
| `Ctrl+Y` | 重做普通编辑 |
| `Enter` | 接受预览结果 |
| `Esc` | 取消绘制或拒绝预览 |

## 14. 常见问题

### 14.1 BBox 报 `pointIJK` 错误

当前已知错误：

```text
TypeError: Cannot read properties of undefined (reading 'pointIJK')
```

原因是当前 Cornerstone 版本默认不保存 Rectangle ROI 的 `pointsInShape`，而 `nninter` 仍从该空数组读取 BBox 角点。该错误发生在前端，请求尚未发送到 MONAI。

故障修复前不要使用 BBox；请改用 Point、Scribble 或 Lasso。

### 14.2 工具报 `hasTool` 错误

```text
TypeError: Cannot read properties of undefined (reading 'hasTool')
```

表示工具命令执行时没有找到对应 ToolGroup，常见于视口尚未准备完成、切换布局过程中或工具与当前视口类型不匹配。可先选择正确视口并等待影像加载完成，再重新选择工具；如果稳定复现，应修复工具组判空逻辑。

### 14.3 工具按钮为灰色

通常表示：

- 没有活动视口。
- 影像尚未加载完成。
- 尚未创建 Segmentation/Segment。
- 工具只支持 MPR、3D、US 或可重建体积。
- 当前 Segment 已锁定。

### 14.4 AI 提示画完后消失

这是默认行为，不代表提示被删除。推理后系统会隐藏提示，按 `O` 或点击 `Show Prompts` 可以恢复显示。

### 14.5 画完提示后没有自动分割

依次检查：

1. AI 工具箱是否被锁定。
2. Live Mode 是否开启；关闭时应点击 `run segmentation`。
3. MONAI Label 的 `/info` 是否可访问。
4. 所选模型是否已在后端加载。
5. 当前 Segment 是否可见且处于活动状态。
6. 浏览器控制台和 MONAI 后端是否有报错。

### 14.6 推理结果不准确

- 在目标内部添加正向点或 Scribble。
- 在误分区域添加负向点或 Scribble。
- 确认 Pos/Neg 状态后再落笔。
- 使用多个分散提示，而不是把所有点放在同一小区域。
- 完成 AI 初始分割后使用 Brush、Eraser 和 Interpolate 修正。

## 15. 推荐操作原则

1. 先浏览完整序列，再开始分割。
2. 一个器官对应一个 Segment。
3. 首次使用时关闭 Live Mode，集中放置提示后手动运行。
4. 每次落笔前确认 Pos/Neg 状态。
5. BBox 修复前使用 Point、Scribble、Lasso。
6. AI 负责生成初始结果，最终边界使用手工工具复核。
7. 完成后立即导出 DICOM SEG，不要只依赖浏览器页面状态。