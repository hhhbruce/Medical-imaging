# NEXUS 离线主页

这是 Medical-imaging 项目的独立主页演示，暂不接入 OHIF Viewer、MONAI Label 或 Orthanc。

## 本地预览

在当前目录启动静态服务器：

```powershell
cd "D:\Smart City\Medical-imaging\landing"
python -m http.server 8791
```

然后打开 <http://localhost:8791/>。

## 页面内容

- 中文为主的 AI 辅助医疗诊断平台叙事。
- Three.js 本地离线三维场景：扫描体积、轴位切片、扫描网格、数据流和器官模型。
- 场景内包含肝脏、肺部、双肾，以及器官目标环和中文标注。
- 滚动驱动六段摄像机路径，章节导航、交互式卡片、指针反馈和移动端侧滑菜单。
- 影像工作流卡片展示逐层查看、交互式分割和辅助报告生成。
- 页面无图片或字体网络依赖；`vendor/three.min.js` 为本地运行时。

## 与现有系统的关系

此目录是离线视觉方案，不修改现有 `Viewers/`、`monai-label/`、`orthanc` 或 Docker 配置。确认视觉方向后，再将主页接入现有应用路由，并把“进入工作台”等入口连接到实际 Viewer 地址。
