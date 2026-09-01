# VR 体渲染最小验证（PoC）

用 vtk.js 内置的 WebXR 模块，把电脑里 3D 体渲染（CT 肝脏）「复刻」进 VR 头显。
不依赖 OHIF 构建，是一个独立静态页面。

## 文件

- `index.html` / `dist/main.js` — 页面（体渲染 + 进入 VR 按钮）
- `liver.vti` — 由 `sample-data` 里的肝脏 DICOM 序列转换而来的体数据
- `convert_dicom_to_vti.py` — DICOM → VTI 转换脚本（换数据时用）
- `serve_https.py` — 真机用的 HTTPS 服务器（自签证书）

## 使用

### 1. 桌面浏览器先看 3D（验证「电脑显示能复刻」）

```powershell
cd "d:\Smart City\Medical-imaging\vr-poc"
python -m http.server 8123
```

打开 `http://localhost:8123`。应能看到肝脏 CT 的 3D 体渲染：
左键拖动旋转、滚轮缩放、右键平移。这就是 OHIF 里同款 vtk.js 体渲染。

> 若页面没有加载出 `liver.vti`，会自动回退到合成体数据（RTAnalyticSource），
> 依然能验证 WebXR 链路。

### 2. 桌面模拟进入 VR（无头显，最快验证 WebXR）

1. Chrome 安装扩展 **WebXR API Emulator**（或 Meta 的 Immersive Web Emulator）。
2. 打开页面，点扩展图标开启模拟。
3. 点「进入 VR」→ 应进入立体画面。

### 3. 真机（Quest / Pico）

```powershell
cd "d:\Smart City\Medical-imaging\vr-poc"
python serve_https.py 8443
```

终端会打印一个 `https://<你的局域网IP>:8443` 地址。用头显浏览器打开它，
首次访问在警告页选择「继续前往」，然后点「进入 VR」。

> 说明：WebXR 要求 secure context。桌面 `localhost` 天然满足（http 即可）；
> 头显访问必须走 HTTPS（自签证书会有一次警告，接受即可）。

## 换真实数据

`convert_dicom_to_vti.py <DICOM目录> <输出.vti>` 后，把输出文件放到本目录并命名为
`liver.vti`（或在 `main.js` 的 `setUrl` 里改路径），重新打包：

```powershell
cd "d:\Smart City\Medical-imaging\Viewers"
$env:NODE_PATH = "D:\Smart City\Medical-imaging\Viewers\node_modules"
npx --no-install esbuild ..\vr-poc\main.js --bundle --format=esm --outfile=..\vr-poc\dist\main.js
```

## 已知边界

- 交互未做：目前只能看，旋转/缩放/裁剪等手柄交互未实现（下一步）。
- 体渲染传递函数是通用默认值，非临床调窗。
- 自签证书在部分头显（如 Vision Pro）上限制较多，Quest/Pico 的浏览器较宽松。
