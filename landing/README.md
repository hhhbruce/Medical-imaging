# NEXUS 离线主页

这是 Medical-imaging 项目的主页（离线自足：字体与 Three.js 全部本地化），已接入系统各后台入口。

## 本地预览

在当前目录启动静态服务器：

```powershell
cd "D:\Smart City\Medical-imaging\landing"
python -m http.server 8791
```

然后打开 <http://localhost:8791/>。

## 入口配置

所有跳转地址集中在 `config.js`（`window.NEXUS_LINKS`），换环境只改这一个文件：

| data-link | 入口 | 本地开发地址 | 说明 |
| --- | --- | --- | --- |
| `workbench` | 进入工作台（后台） | `http://localhost:3000/` | 与研究空间「打开研究空间」同址（OHIF Viewer） |
| `pacs` | PACS 后台（中间件后台） | `http://localhost:8042/` | Orthanc Explorer，检查/实例管理 |
| `lab` | 打开研究空间 | `http://localhost:3000/` | 本地研究服务 |
| `atlas` | 人体图谱（新入口） | `http://localhost:5173/` | `landing/landing/` Vite 应用，交互式 3D 解剖图谱 |

入口位置：导航栏「PACS 后台」与右上「进入工作台」、研究空间章节「打开研究空间」按钮、页脚「进入工作台」。≤900px 时右上按钮隐藏，移动端抽屉内显示「进入工作台」和「PACS 后台」两个链接。所有入口均在新标签页打开。新增的「人体图谱」入口位于导航栏「研究空间」之后与页脚「探索」栏，指向 `landing/landing/` 的 Vite 应用（与主页一起由 `start-dev.ps1` 拉起）。

迁移到 nginx 同源部署（方案 A）时：在 `docker-compose.yml` 的 ohif_viewer 加挂载 `./landing:/var/www/html/home:ro`，`nginx.conf` 加 `location /home/` 静态块，并把 `config.js` 中的地址改为同源相对路径（见 config.js 内注释）。

## 系统路由总览

| 页面 | 地址 | 进程 | 返回主页方式 |
| --- | --- | --- | --- |
| 主页 | `http://localhost:8791/` | `landing/` 静态页（python http.server） | —（系统入口） |
| 人体图谱 | `http://localhost:5173/` | `landing/landing/` vite dev | 左上角「返回 NEXUS 主页」 |
| 研究空间 | `http://localhost:3000/` | Viewers rsbuild dev（OHIF + /monai 代理） | 左上角 NEXUS logo |
| 后台 | `http://localhost:1026/` | docker ohif_viewer（nginx + OHIF 生产构建） | 左上角 NEXUS logo（需重新构建镜像后生效） |
| 中间件后台 | `http://localhost:8042/` | docker orthanc（Orthanc Explorer） | 浏览器返回 |
| MONAI Label | `http://localhost:8002/` | 本机原生 conda 进程 | 无页面，API 服务 |

研究空间与后台共用 `Viewers/platform/app/public/config/docker-nginx-orthanc.js`，其中的 `whiteLabeling.createLogoComponentFn` 负责渲染返回主页的 logo 链接。研究空间启动方式见 [`docs/backstart.md`](../docs/backstart.md)。

## 一键启动

```powershell
cd "D:\Smart City\Medical-imaging"
powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
```

按 `docs/backstart.md` 的顺序拉起 Orthanc、主页、人体图谱、研究空间，并自动打开主页；可选 `-WithMonai`（MONAI Label）、`-WithWorkbench`（docker 后台）、`-Stop`（停掉主页/人体图谱/研究空间三个开发服务）。

## 页面内容

- 中文为主的 AI 辅助医疗诊断平台叙事。
- Three.js 本地离线三维场景：扫描体积、轴位切片、扫描网格、数据流和器官模型。
- 场景内包含肝脏、肺部、双肾，以及器官目标环和中文标注。
- 滚动驱动六段摄像机路径，章节导航、交互式卡片、指针反馈和移动端侧滑菜单。
- 影像工作流卡片展示逐层查看、交互式分割和辅助报告生成。
- 页面无图片或字体网络依赖；`vendor/three.min.js` 为本地运行时。

## 与现有系统的关系

此目录不修改现有 `Viewers/`、`monai-label/`、`orthanc` 的代码；入口地址统一由 `config.js` 提供。后续按方案 A 挂载进 ohif_viewer 的 nginx 即完成同源部署（步骤见上）。
