// VR Preview renderer: receives a serialized volume + transfer function + camera
// from the OHIF viewer via postMessage, and renders the same 3D volume.

import '@kitware/vtk.js/Rendering/Profiles/Volume';

import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkVolumeProperty from '@kitware/vtk.js/Rendering/Core/VolumeProperty';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

const TYPED_ARRAY = {
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

const statusEl = document.getElementById('status');
function setStatus(msg) {
  if (statusEl) {
    statusEl.textContent = msg;
  }
}

function rebuildScalars(payload) {
  const { scalars, dataType } = payload;
  // postMessage structured-clones TypedArrays, so scalars should already be a
  // TypedArray of the right type. Rebuild defensively in case it arrives as a
  // plain ArrayBuffer.
  if (scalars && ArrayBuffer.isView(scalars)) {
    return scalars;
  }
  const TA = TYPED_ARRAY[dataType] || Float32Array;
  if (scalars instanceof ArrayBuffer) {
    return new TA(scalars);
  }
  // fallback: plain array
  return TA.from(scalars || []);
}

function render(payload) {
  const { dimensions, spacing, origin, direction } = payload;

  const imageData = vtkImageData.newInstance();
  imageData.setDimensions(dimensions[0], dimensions[1], dimensions[2]);
  imageData.setSpacing(spacing[0], spacing[1], spacing[2]);
  imageData.setOrigin(origin[0], origin[1], origin[2]);
  imageData.setDirection(direction);

  const scalars = vtkDataArray.newInstance({
    name: 'Scalars',
    numberOfComponents: 1,
    values: rebuildScalars(payload),
  });
  imageData.getPointData().setScalars(scalars);

  const ctfun = vtkColorTransferFunction.newInstance();
  (payload.rgbPoints || []).forEach(p => ctfun.addRGBPoint(p[0], p[1], p[2], p[3], p[4], p[5]));

  const ofun = vtkPiecewiseFunction.newInstance();
  (payload.opacityPoints || []).forEach(p => ofun.addPoint(p[0], p[1], p[2], p[3]));

  const property = vtkVolumeProperty.newInstance();
  property.setRGBTransferFunction(0, ctfun);
  property.setScalarOpacity(0, ofun);
  if (payload.shade !== undefined) property.setShade(payload.shade);
  if (payload.ambient !== undefined) property.setAmbient(payload.ambient);
  if (payload.diffuse !== undefined) property.setDiffuse(payload.diffuse);
  if (payload.specular !== undefined) property.setSpecular(payload.specular);
  if (payload.interpolationType !== undefined) property.setInterpolationType(payload.interpolationType);

  const actor = vtkVolume.newInstance();
  const mapper = vtkVolumeMapper.newInstance();
  mapper.setInputData(imageData);
  actor.setMapper(mapper);
  actor.setProperty(property);

  const fullScreen = vtkFullScreenRenderWindow.newInstance({ background: [0, 0, 0] });
  const renderer = fullScreen.getRenderer();
  const renderWindow = fullScreen.getRenderWindow();
  renderer.addActor(actor);
  renderer.resetCamera();

  if (payload.camera) {
    const cam = renderer.getActiveCamera();
    const c = payload.camera;
    if (c.position) cam.setPosition(...c.position);
    if (c.focalPoint) cam.setFocalPoint(...c.focalPoint);
    if (c.viewUp) cam.setViewUp(...c.viewUp);
    // vtk.js cameras expose `setParallelProjection(boolean)`; there is no
    // `parallelProjectionOn/Off` in this vtk.js version.
    cam.setParallelProjection(Boolean(c.parallelProjection));
    if (c.parallelScale !== undefined) cam.setParallelScale(c.parallelScale);
    if (c.clippingRange) cam.setClippingRange(...c.clippingRange);
  }

  renderWindow.render();
  setStatus('已投影渲染');
}

window.addEventListener('message', event => {
  if (event.data && event.data.type === 'vr-preview') {
    try {
      render(event.data.payload);
    } catch (err) {
      console.error('vr-preview render failed', err);
      setStatus('渲染失败：' + err.message);
    }
  }
});

// BroadcastChannel fallback: the opener may be blocked from opening popups, in
// which case it broadcasts the volume on this channel instead. This lets a
// manually-opened vr-preview.html tab receive data without a window reference.
let vrChannel = null;
try {
  vrChannel = new BroadcastChannel('vr-preview');
} catch (err) {
  // BroadcastChannel unsupported; the opener-postMessage path still works.
}
if (vrChannel) {
  vrChannel.onmessage = event => {
    if (event.data && event.data.type === 'vr-preview') {
      try {
        render(event.data.payload);
      } catch (err) {
        console.error('vr-preview render failed', err);
        setStatus('渲染失败：' + err.message);
      }
    }
  };
}

// Tell any opener/listener we're ready to receive the volume data. The opener
// uses this as an explicit signal (in addition to the `load` event + retry
// timer), which avoids the race where it posts before our listener exists.
if (window.opener) {
  try {
    window.opener.postMessage({ type: 'vr-preview-ready' }, window.location.origin);
  } catch (err) {
    // ignore: opener may be gone or cross-origin
  }
}
if (vrChannel) {
  try {
    vrChannel.postMessage({ type: 'vr-preview-ready' });
  } catch (err) {
    // ignore
  }
}

// This page is a pure receiver: it has no volume data of its own and only
// renders what an opener window (the OHIF viewer's VR button) posts to it.
// Make the direct-URL case explicit so it isn't mistaken for a bug.
setStatus(
  window.opener
    ? '等待投影数据…'
    : '等待投影数据…（本页需从 OHIF 查看器的「VR 展示」按钮打开；直接访问 URL 不会有数据传入）'
);
