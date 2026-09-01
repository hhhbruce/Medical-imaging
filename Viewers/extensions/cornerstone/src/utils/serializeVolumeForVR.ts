/**
 * Extracts the current 3D volume rendering state (volume data, transfer
 * function, camera) from a Cornerstone3D volume viewport into a plain object
 * that can be passed over postMessage to the VR preview window.
 */

export type VRPreviewPayload = {
  dimensions: number[];
  spacing: number[];
  origin: number[];
  direction: number[];
  scalars: unknown; // TypedArray (structured-clone safe)
  dataType: string;
  rgbPoints: number[][];
  opacityPoints: number[][];
  shade: boolean;
  ambient: number;
  diffuse: number;
  specular: number;
  interpolationType: number;
  camera: {
    position: number[];
    focalPoint: number[];
    viewUp: number[];
    parallelProjection: boolean;
    parallelScale: number;
    clippingRange?: number[];
    viewPlaneNormal?: number[];
  };
};

/**
 * Cornerstone3D streaming volumes keep their voxel data inside a VoxelManager,
 * not in `imageData.getPointData().getScalars()`. Try the VoxelManager first
 * (it exposes `getCompleteScalarDataArray`), then fall back to the vtkImageData
 * point-data scalars for non-streaming volumes.
 */
function extractScalarData(viewport, imageData): unknown {
  let imageInfo = null;
  if (viewport && typeof viewport.getImageData === 'function') {
    try {
      imageInfo = viewport.getImageData();
    } catch (e) {
      imageInfo = null;
    }
  }

  const voxelManager = imageInfo && imageInfo.voxelManager;
  if (voxelManager) {
    if (typeof voxelManager.getCompleteScalarDataArray === 'function') {
      try {
        const arr = voxelManager.getCompleteScalarDataArray();
        if (arr && arr.length) {
          return arr;
        }
      } catch (e) {
        // fall through
      }
    }
    if (typeof voxelManager.getScalarData === 'function') {
      try {
        const arr = voxelManager.getScalarData();
        if (arr && arr.length) {
          return arr;
        }
      } catch (e) {
        // fall through
      }
    }
  }

  const pointData = imageData && imageData.getPointData ? imageData.getPointData() : null;
  const scalarsObj = pointData && pointData.getScalars ? pointData.getScalars() : null;
  const scalarData = scalarsObj && scalarsObj.getData ? scalarsObj.getData() : null;
  return scalarData && scalarData.length ? scalarData : null;
}

/**
 * The viewport camera is a plain serializable object in this OHIF fork:
 * `{ position, focalPoint, viewUp, parallelProjection, parallelScale, ... }`.
 * Handle both that shape and a vtk-style camera with getter methods.
 */
function extractCamera(viewport): VRPreviewPayload['camera'] {
  const camera = viewport.getCamera();
  if (!camera) {
    return null;
  }

  const read = (key, getterName) => {
    if (Array.isArray(camera[key]) || typeof camera[key] === 'number' || typeof camera[key] === 'boolean') {
      return camera[key];
    }
    if (typeof camera[getterName] === 'function') {
      return camera[getterName]();
    }
    return undefined;
  };

  const position = read('position', 'getPosition');
  const focalPoint = read('focalPoint', 'getFocalPoint');
  const viewUp = read('viewUp', 'getViewUp');
  const parallelProjection = read('parallelProjection', 'getParallelProjection');
  const parallelScale = read('parallelScale', 'getParallelScale');
  const clippingRange = read('clippingRange', 'getClippingRange');
  const viewPlaneNormal = read('viewPlaneNormal', 'getViewPlaneNormal');

  if (!position || !focalPoint || !viewUp) {
    return null;
  }

  return {
    position,
    focalPoint,
    viewUp,
    parallelProjection: parallelProjection !== undefined ? parallelProjection : true,
    parallelScale,
    clippingRange,
    viewPlaneNormal,
  };
}

/**
 * Cap the volume's largest dimension so the postMessage payload and the
 * preview window's GPU memory stay reasonable. Full-resolution 512x512x472 CT
 * volumes are ~247 MB as Int16, which is too heavy for a minimal browser
 * preview. The downsample keeps the physical extent (spacing is scaled by the
 * same factor) so the camera transform stays valid.
 */
const MAX_DIMENSION = 256;

function downsampleScalars(scalarData, dims, factor, outDims): unknown {
  const [nx, ny, nz] = dims;
  const [onx, ony, onz] = outDims;
  const Ctor = scalarData.constructor;
  const out = new Ctor(onx * ony * onz);
  let o = 0;
  for (let k = 0; k < onz; k++) {
    const sk = Math.min(k * factor, nz - 1) * nx * ny;
    for (let j = 0; j < ony; j++) {
      const base = sk + Math.min(j * factor, ny - 1) * nx;
      for (let i = 0; i < onx; i++) {
        out[o++] = scalarData[base + Math.min(i * factor, nx - 1)];
      }
    }
  }
  return out;
}

export function serializeVolumeForVR(viewport): VRPreviewPayload | null {
  if (!viewport || typeof viewport.getActors !== 'function') {
    return null;
  }

  const actors = viewport.getActors();
  if (!actors || actors.length === 0 || !actors[0].actor) {
    return null;
  }

  const { actor } = actors[0];
  const mapper = actor.getMapper();
  if (!mapper) {
    return null;
  }

  const imageData = mapper.getInputData();
  if (!imageData) {
    return null;
  }

  const scalarData = extractScalarData(viewport, imageData);
  if (!scalarData) {
    return null;
  }

  const fullDims = imageData.getDimensions();
  const fullSpacing = imageData.getSpacing();
  const maxDim = Math.max(fullDims[0], fullDims[1], fullDims[2]);
  const factor = maxDim > MAX_DIMENSION ? Math.ceil(maxDim / MAX_DIMENSION) : 1;

  let dimensions = fullDims;
  let spacing = fullSpacing;
  let scalars = scalarData;
  if (factor > 1) {
    dimensions = [
      Math.ceil(fullDims[0] / factor),
      Math.ceil(fullDims[1] / factor),
      Math.ceil(fullDims[2] / factor),
    ];
    spacing = [fullSpacing[0] * factor, fullSpacing[1] * factor, fullSpacing[2] * factor];
    scalars = downsampleScalars(scalarData, fullDims, factor, dimensions);
  }

  const property = actor.getProperty();

  // Transfer function points
  const rgbPoints: number[][] = [];
  const ctfun = property.getRGBTransferFunction(0);
  if (ctfun) {
    for (let i = 0; i < ctfun.getSize(); i++) {
      const node = [0, 0, 0, 0, 0, 0];
      ctfun.getNodeValue(i, node);
      rgbPoints.push(node);
    }
  }

  const opacityPoints: number[][] = [];
  const ofun = property.getScalarOpacity(0);
  if (ofun) {
    for (let i = 0; i < ofun.getSize(); i++) {
      const node = [0, 0, 0, 0];
      ofun.getNodeValue(i, node);
      opacityPoints.push(node);
    }
  }

  // `vtkVolumeProperty` exposes shade/specular, while `vtkImageProperty` (MPR
  // mode) does not. Use safe accessors with vtk.js defaults so the serializer
  // never throws regardless of the current rendering mode.
  const safeGet = (method, fallback) =>
    typeof property[method] === 'function' ? property[method]() : fallback;

  return {
    dimensions,
    spacing,
    origin: imageData.getOrigin(),
    direction: imageData.getDirection(),
    scalars,
    dataType: scalars.constructor.name,
    rgbPoints,
    opacityPoints,
    shade: safeGet('getShade', true),
    ambient: safeGet('getAmbient', 0.1),
    diffuse: safeGet('getDiffuse', 0.9),
    specular: safeGet('getSpecular', 0.2),
    interpolationType: safeGet('getInterpolationType', 2),
    camera: extractCamera(viewport),
  };
}
