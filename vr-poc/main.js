import '@kitware/vtk.js/Rendering/Profiles/Volume';

import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkVolumeProperty from '@kitware/vtk.js/Rendering/Core/VolumeProperty';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkRTAnalyticSource from '@kitware/vtk.js/Filters/Sources/RTAnalyticSource';
import vtkXMLImageDataReader from '@kitware/vtk.js/IO/XML/XMLImageDataReader';
import WebXR from '@kitware/vtk.js/Rendering/WebXR';

const statusEl = document.getElementById('status');
const enterBtn = document.getElementById('enter-vr');
const exitBtn = document.getElementById('exit-vr');

function setStatus(msg) {
  statusEl.textContent = msg;
}

// --- render window + scene -------------------------------------------------
const fullScreen = vtkFullScreenRenderWindow.newInstance({ background: [0, 0, 0] });
const renderWindow = fullScreen.getRenderWindow();
const renderer = fullScreen.getRenderer();

const actor = vtkVolume.newInstance();
const mapper = vtkVolumeMapper.newInstance();
const property = vtkVolumeProperty.newInstance();
actor.setMapper(mapper);
actor.setProperty(property);
renderer.addActor(actor);

// --- WebXR helper ----------------------------------------------------------
const { vtkRenderWindowHelper } = WebXR;
const xrHelper = vtkRenderWindowHelper.newInstance({ renderWindow });

// --- transfer function -----------------------------------------------------
function applyCTTransferFunctions(range) {
  const [lo, hi] = range;
  const ctfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();

  // grayscale with bone-ish highlight, opacity ramps through soft tissue
  ctfun.addRGBPoint(lo, 0.0, 0.0, 0.0);
  ctfun.addRGBPoint((lo + hi) * 0.55, 0.55, 0.55, 0.55);
  ctfun.addRGBPoint((lo + hi) * 0.72, 0.9, 0.9, 0.9);
  ctfun.addRGBPoint(hi, 1.0, 1.0, 1.0);

  ofun.addPoint(lo, 0.0);
  ofun.addPoint((lo + hi) * 0.55, 0.02);
  ofun.addPoint((lo + hi) * 0.62, 0.08);
  ofun.addPoint((lo + hi) * 0.72, 0.3);
  ofun.addPoint(hi, 0.55);

  property.setRGBTransferFunction(0, ctfun);
  property.setScalarOpacity(0, ofun);
  property.setInterpolationTypeToLinear();
  property.setShade(true);
  property.setAmbient(0.15);
  property.setDiffuse(0.85);
  property.setSpecular(0.1);
}

function applySyntheticTransferFunctions(range) {
  const [lo, hi] = range;
  const ctfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();

  ctfun.addRGBPoint(lo, 0.2, 0.3, 0.8);
  ctfun.addRGBPoint((lo + hi) * 0.5, 0.1, 0.7, 0.6);
  ctfun.addRGBPoint(hi, 1.0, 0.9, 0.4);

  ofun.addPoint(lo, 0.0);
  ofun.addPoint((lo + hi) * 0.35, 0.02);
  ofun.addPoint((lo + hi) * 0.6, 0.15);
  ofun.addPoint(hi, 0.5);

  property.setRGBTransferFunction(0, ctfun);
  property.setScalarOpacity(0, ofun);
  property.setInterpolationTypeToLinear();
  property.setShade(true);
}

function present(imageData, sourceLabel) {
  const scalars = imageData.getPointData().getScalars();
  const range = scalars ? scalars.getRange() : [0, 1];
  mapper.setInputData(imageData);
  // CT HU data vs. synthetic analytic field
  if (range[0] <= -1000) {
    applyCTTransferFunctions(range);
  } else {
    applySyntheticTransferFunctions(range);
  }
  renderer.resetCamera();
  renderWindow.render();
  setStatus('已加载' + sourceLabel + '，点击「进入 VR」');
  enterBtn.disabled = false;
}

// --- load data: real liver.vti first, synthetic fallback -------------------
function loadSynthetic(reason) {
  setStatus(
    reason
      ? 'liver.vti 加载失败（' + reason + '），改用合成体数据'
      : '未找到 liver.vti，使用合成体数据'
  );
  const source = vtkRTAnalyticSource.newInstance();
  source.setWholeExtent(0, 63, 0, 63, 0, 63);
  source.setCenter(32, 32, 32);
  source.update();
  present(source.getOutputData(), '合成体数据');
}

async function loadReal() {
  try {
    const resp = await fetch('liver.vti');
    if (!resp.ok) {
      throw new Error('HTTP ' + resp.status);
    }
    const arrayBuffer = await resp.arrayBuffer();
    const reader = vtkXMLImageDataReader.newInstance();
    reader.parseAsArrayBuffer(arrayBuffer);
    const data = reader.getOutputData();
    if (!data || data.getNumberOfPoints() === 0) {
      throw new Error('empty volume');
    }
    present(data, '真实肝脏 CT');
  } catch (err) {
    console.warn('load liver.vti failed, falling back to synthetic', err);
    loadSynthetic(err.message);
  }
}

// --- VR controls -----------------------------------------------------------
function onXrSupported() {
  enterBtn.disabled = false;
  setStatus(navigator.xr ? 'WebXR 可用' : '当前浏览器不支持 WebXR（需 HTTPS 或 localhost）');
}

enterBtn.addEventListener('click', () => {
  try {
    xrHelper.startXR();
    setStatus('已进入 VR（在头显中查看）');
    enterBtn.classList.add('disabled');
    exitBtn.classList.remove('disabled');
  } catch (err) {
    setStatus('进入 VR 失败：' + err.message);
  }
});

exitBtn.addEventListener('click', async () => {
  await xrHelper.stopXR();
  setStatus('已退出 VR');
  enterBtn.classList.remove('disabled');
  exitBtn.classList.add('disabled');
});

// ---------------------------------------------------------------------------
setStatus('加载数据中…');
loadReal();
