# Medical Imaging 本地开发启动指南

项目目录：`D:\Smart City\Medical-imaging`

启动顺序：**Orthanc → MONAI Label 后端 → OHIF 前端**。三个服务建议分别使用独立的 PowerShell 终端。

基础查看器页面和工具说明见 [`basic-viewer-user-guide.md`](./basic-viewer-user-guide.md)。

## 1. 启动 Orthanc

```powershell
Set-Location "D:\Smart City\Medical-imaging"
docker compose up -d orthanc
```

检查状态：

```powershell
docker compose ps orthanc
Invoke-RestMethod "http://localhost:8042/system"
```

服务地址：

- Orthanc HTTP/API：`http://localhost:8042`
- DICOMWeb：`http://localhost:8042/dicom-web`
- DICOM：`localhost:4242`
- 容器名：`PACS`

## 2. 启动 MONAI Label 后端

```powershell
Set-Location "D:\Smart City\Medical-imaging"

# PYTHONPATH 必需：monailabel 未 pip 安装到 conda 环境，靠它解析本地源码
$env:PYTHONPATH = "D:\Smart City\Medical-imaging\monai-label"
# 模型中央目录：须包含 sam2.1_hiera_tiny.pt、MedSAM2_latest.pt、sam3.pt、
# nnInteractive.pth、vox_v1.1/ 等权重（文件名须与 basic_infer.py 一致）
$env:MONAI_LABEL_CHECKPOINTS_DIR = "D:\Smart City\checkpoints"
# 运行时产物目录：predictions/、img_cache/ 会创建在这里
$env:MONAI_LABEL_RUNTIME_DIR = "D:\Smart City\Medical-imaging\monai-label"

$env:LOAD_SAM2 = "lazy"
$env:LOAD_SAM3 = "lazy"
$env:LOAD_MEDSAM2 = "lazy"
$env:LOAD_VOXTELL = "lazy"
$env:PYTHONUNBUFFERED = "1"

conda run --no-capture-output -n smartcity python -u -m monailabel.main start_server `
  --app "D:\Smart City\Medical-imaging\monai-label\sample-apps\radiology" `
  --studies "http://localhost:8042/dicom-web" `
  --conf models segmentation `
  --conf use_pretrained_model false `
  --host 0.0.0.0 `
  --port 8002
```

检查状态：

```powershell
Invoke-RestMethod "http://localhost:8002/info"
```

如果启动失败，先确认 8002 端口没有被旧的 MONAI 进程占用（新进程会 bind 失败）：

```powershell
Get-NetTCPConnection -LocalPort 8002 -State Listen | ForEach-Object {
  Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)" |
    Select-Object ProcessId, CreationDate, CommandLine
}
# 确认是残留的旧进程后停止：Stop-Process -Id <PID>
```

服务地址：

- MONAI Label：`http://localhost:8002`
- OpenAPI：`http://localhost:8002/openapi.json`

## 3. 启动 OHIF 前端

前端使用 Node `20.9.0`、Yarn `1.22.22` 和 Rsbuild。

当前机器的 NVM 版本目录是 `D:\environment\nvm\v20.9.0`。不要在启动脚本中执行 `nvm use 20.9.0`，也不要依赖 `C:\nvm4w\nodejs`：当前 NVM 执行版本切换后没有生成可用的 `NVM_SYMLINK`，虽然会输出 `Now using node v20.9.0`，但当前 PowerShell 随后无法解析 `node`、`corepack` 和 `yarn`。

使用 Node 的真实安装目录，并通过 Node 自带的 Corepack 调用项目指定的 Yarn：

```powershell
Set-Location "D:\Smart City\Medical-imaging\Viewers"

$nodeDir = "D:\environment\nvm\v20.9.0"
$env:Path = "$nodeDir;$env:Path"

node -v
corepack yarn --version

$env:NODE_ENV = "development"
$env:MONAI_PROXY_DOMAIN = "http://localhost:8002"
$env:PROXY_TARGET = "/pacs/dicom-web"
$env:PROXY_DOMAIN = "http://localhost:8042"
$env:PROXY_PATH_REWRITE_FROM = "/pacs/dicom-web"
$env:PROXY_PATH_REWRITE_TO = "/dicom-web"
$env:APP_CONFIG = "config/docker-nginx-orthanc.js"

corepack yarn dev:fast
```

版本检查应输出 Node `v20.9.0` 和 Yarn `1.22.22`。前端启动成功后，Rsbuild 会输出：

```text
Local: http://localhost:3000/
ready Built in ... (web)
```

前端地址：`http://localhost:3000`

本地 Windows 开发使用上述 Rsbuild 入口。当前不使用传统的 `yarn dev:orthanc` Webpack 入口。

## 4. 验证完整链路

保持三个服务运行，在另一个 PowerShell 终端执行：

```powershell
Invoke-WebRequest "http://localhost:3000/" -UseBasicParsing
Invoke-WebRequest "http://localhost:3000/pacs/dicom-web/studies" -UseBasicParsing
Invoke-WebRequest "http://localhost:3000/monai/info" -UseBasicParsing
```

三个请求均应返回 HTTP `200`。Orthanc 当前没有影像时，DICOMWeb studies 响应为 `[]`。

## 5. 停止服务

- OHIF 前端：在前端终端按 `Ctrl+C`。
- MONAI Label 后端：在后端终端按 `Ctrl+C`。
- Orthanc：

```powershell
Set-Location "D:\Smart City\Medical-imaging"
docker compose stop orthanc
```
