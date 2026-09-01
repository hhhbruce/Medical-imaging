import * as cornerstoneTools from '@cornerstonejs/tools';

// A segmentation may use one stack labelmap per segment. Cornerstone's public
// statistics helpers still read the legacy Labelmap.imageIds field, which points
// to the primary layer only. Serialize temporary layer selection so stats and
// bidirectional measurements operate on the segment's bound layer without
// allowing concurrent workers to observe a half-switched state.
const _segmentationLayerQueues = new Map<string, Promise<unknown>>();

function getSegmentLayerInfo(segmentationId: string, segmentIndex: number) {
  const segmentation = cornerstoneTools.segmentation.state.getSegmentation(segmentationId);
  const labelmap = segmentation?.representationData?.Labelmap as any;
  if (!segmentation || !labelmap) {
    return null;
  }

  const binding = labelmap.segmentBindings?.[segmentIndex];
  const layer = binding ? labelmap.labelmaps?.[binding.labelmapId] : null;
  const imageIds = layer?.imageIds;
  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return null;
  }

  return {
    labelmap,
    imageIds,
    labelValue: Number(binding?.labelValue ?? segmentIndex),
  };
}

async function withSegmentLayer<T>(
  segmentationId: string,
  segmentIndex: number,
  callback: () => Promise<T>
): Promise<T> {
  const previous = _segmentationLayerQueues.get(segmentationId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const layerInfo = getSegmentLayerInfo(segmentationId, segmentIndex);
      if (!layerInfo) {
        return callback();
      }

      const { labelmap, imageIds } = layerInfo;
      const previousImageIds = labelmap.imageIds;
      const previousVolumeId = labelmap.volumeId;
      // Force the worker helper down its stack path for this bound layer. The
      // legacy volume, when present, belongs to the primary layer.
      labelmap.imageIds = imageIds;
      delete labelmap.volumeId;
      try {
        return await callback();
      } finally {
        labelmap.imageIds = previousImageIds;
        if (previousVolumeId !== undefined) {
          labelmap.volumeId = previousVolumeId;
        }
      }
    });
  _segmentationLayerQueues.set(segmentationId, current);
  try {
    return await current;
  } finally {
    if (_segmentationLayerQueues.get(segmentationId) === current) {
      _segmentationLayerQueues.delete(segmentationId);
    }
  }
}

async function getStatisticsForSegment(segmentationId: string, segmentIndex: number) {
  const layerInfo = getSegmentLayerInfo(segmentationId, segmentIndex);
  const labelValue = layerInfo?.labelValue ?? segmentIndex;
  return withSegmentLayer(segmentationId, segmentIndex, () =>
    cornerstoneTools.utilities.segmentation.getStatistics({
      segmentationId,
      segmentIndices: [labelValue],
      mode: 'individual',
    })
  );
}

export async function getSegmentLargestBidirectionalForSegment({
  segmentationId,
  segmentIndex,
}: {
  segmentationId: string;
  segmentIndex: number;
}) {
  const layerInfo = getSegmentLayerInfo(segmentationId, segmentIndex);
  const labelValue = layerInfo?.labelValue ?? segmentIndex;
  return withSegmentLayer(segmentationId, segmentIndex, () =>
    cornerstoneTools.utilities.segmentation.getSegmentLargestBidirectional({
      segmentationId,
      segmentIndices: [labelValue],
    })
  );
}

interface BidirectionalAxis {
  length: number;
  // Add other axis properties as needed
}

interface BidirectionalData {
  majorAxis: BidirectionalAxis;
  minorAxis: BidirectionalAxis;
}

// A stat value is only usable if it is finite (or an array of finite numbers).
// Non-finite values (NaN / ±Infinity) come from computing on incomplete data
// (e.g. an MPR volume that hasn't fully populated) — we skip them rather than
// display "NaN"/"Inf", keeping any previously-computed valid value instead.
function isFiniteStatValue(v: any): boolean {
  if (v == null) {
    return false;
  }
  if (Array.isArray(v)) {
    return v.length > 0 && v.every(x => Number.isFinite(x));
  }
  return Number.isFinite(v);
}

// The compute worker always reports volume in mm³. Normalize to cm³ (÷1000) so the
// panel shows a single consistent unit for every segment and every stats path.
function toCm3(value: any): any {
  return Array.isArray(value) ? value.map(v => v / 1000) : value / 1000;
}
function isMm3Unit(unit: any): boolean {
  return unit === 'mm³' || unit === 'mm3' || unit === 'mm^3';
}

// Mark/unmark the given segments as "stats pending" so the panel can show a
// "Calculating…" indicator while the (now deferred, off-critical-path) worker runs.
// Uses updateSegmentations (fires SEGMENTATION_MODIFIED, not DATA_MODIFIED) so it does
// NOT re-enter the DATA_MODIFIED stats handler — same mechanism as the stats commit.
function setSegmentsStatsPending(
  segmentationId: string,
  segmentIndices: number[],
  pending: boolean
): void {
  const seg = cornerstoneTools.segmentation.state.getSegmentation(segmentationId);
  if (!seg?.segments) {
    return;
  }
  const segments = { ...seg.segments };
  let changed = false;
  for (const idx of segmentIndices) {
    const s = segments[idx];
    if (!s) {
      continue;
    }
    const cachedStats = { ...(s.cachedStats ?? {}) };
    if (!!cachedStats.statsPending === pending) {
      continue;
    }
    cachedStats.statsPending = pending;
    segments[idx] = { ...s, cachedStats };
    changed = true;
  }
  if (!changed) {
    return;
  }
  cornerstoneTools.segmentation.updateSegmentations([{ segmentationId, payload: { segments } }]);
}

/**
 * Updates the statistics for a segmentation by calculating stats for each segment
 * and storing them in the segment's cachedStats property
 *
 * @param segmentation - The segmentation object containing segments to update stats for
 * @param segmentationId - The ID of the segmentation
 * @returns The updated segmentation object with new stats, or null if no updates were made
 */
export async function updateSegmentationStats({
  segmentation,
  segmentationId,
  readableText,
  targetSegmentIndex,
}: {
  segmentation: any;
  segmentationId: string;
  readableText: any;
  targetSegmentIndex?: number;
}): Promise<any | null> {
  if (!segmentation) {
    console.debug('No segmentation found for id:', segmentationId);
    return null;
  }

  const currentSegmentation =
    cornerstoneTools.segmentation.state.getSegmentation(segmentationId) ?? segmentation;

  // When targetSegmentIndex is provided, compute stats only for that segment.
  // Other segments keep their existing cachedStats — correct for non-overlapping multi-segment.
  const segmentIndices =
    targetSegmentIndex !== undefined
      ? [targetSegmentIndex]
      : Object.keys(currentSegmentation.segments)
          .map(index => parseInt(index))
          .filter(index => index > 0); // Filter out segment 0 which is typically background

  if (segmentIndices.length === 0) {
    console.debug('No segments found in segmentation:', segmentationId);
    return null;
  }

  // Signal "calculating" to the panel for the duration of the (deferred) worker run.
  // ONLY for the per-segment path (targetSegmentIndex provided). The generic all-segments
  // handler path recomputes every segment on each change and is slow + frequently retriggered
  // — if it marked pending, unchanged segments would show "Calculating…" forever.
  const trackPending = targetSegmentIndex !== undefined;
  if (trackPending) {
    setSegmentsStatsPending(segmentationId, segmentIndices, true);
  }
  try {
    const stats: Record<string, any> = {};
    // Each segment can be bound to a different labelmap layer. Compute them one
    // at a time so the worker receives the imageIds for that segment's layer.
    for (const segmentIndex of segmentIndices) {
      const segmentStats = await getStatisticsForSegment(segmentationId, segmentIndex);
      const labelValue =
        getSegmentLayerInfo(segmentationId, segmentIndex)?.labelValue ?? segmentIndex;
      const stat = segmentStats?.[labelValue] ?? segmentStats?.[segmentIndex];
      if (stat) {
        stats[segmentIndex] = stat;
      }
    }

    if (Object.keys(stats).length === 0) {
      return null;
    }

    // Re-read after the async worker call so a concurrent segment add cannot be
    // overwritten when we persist stats (Object.assign replaces the whole segments map).
    const latestSegmentation =
      cornerstoneTools.segmentation.state.getSegmentation(segmentationId) ?? currentSegmentation;

    const updatedSegmentation = {
      ...latestSegmentation,
      segments: { ...latestSegmentation.segments },
    };
    let hasUpdates = false;

    Object.entries(stats).forEach(([segmentIndex, segmentStats]) => {
      const index = parseInt(segmentIndex);

      if (!updatedSegmentation.segments[index]) {
        return;
      }

      const segment = {
        ...updatedSegmentation.segments[index],
        cachedStats: {
          ...(updatedSegmentation.segments[index].cachedStats ?? {}),
        },
      };
      // statsPending is managed exclusively by setSegmentsStatsPending (which reads fresh
      // state). Never persist a stale value through the stats commit, or a slow concurrent
      // all-segments recompute could resurrect it and leave "Calculating…" stuck.
      delete segment.cachedStats.statsPending;

      const namedStats = { ...(segment.cachedStats.namedStats ?? {}) };

      const arrayStats = segmentStats.array ?? [];
      arrayStats.forEach(stat => {
        if (!readableText[stat.name]) {
          return;
        }
        if (!stat?.name) {
          return;
        }
        let value = stat.value;
        let unit = stat.unit;
        // The worker reports volume in mm³ via stats.array; normalize to cm³ so the
        // panel is consistent (this array entry otherwise wins over the cm³ block below).
        if (stat.name === 'volume' && isMm3Unit(unit)) {
          value = toCm3(value);
          unit = 'cm³';
        }
        if (!isFiniteStatValue(value)) {
          return; // skip NaN/Inf — keep any prior valid value, show "Calculating…" meanwhile
        }
        namedStats[stat.name] = {
          name: stat.name,
          label: readableText[stat.name],
          value,
          unit,
          order: Object.keys(readableText).indexOf(stat.name),
        };
      });

      ['mean', 'max', 'min', 'count', 'median', 'stdDev', 'volume'].forEach(name => {
        if (!readableText[name] || namedStats[name]) {
          return;
        }
        const stat = segmentStats[name];
        if (stat?.value == null) {
          return;
        }
        const value = name === 'volume' ? toCm3(stat.value) : stat.value;
        if (!isFiniteStatValue(value)) {
          return;
        }
        namedStats[name] = {
          name,
          label: readableText[name],
          value,
          unit: name === 'volume' ? 'cm³' : stat.unit,
          order: Object.keys(readableText).indexOf(name),
        };
      });

      if (Object.keys(namedStats).length > 0) {
        segment.cachedStats.namedStats = namedStats;
        updatedSegmentation.segments[index] = segment;
        hasUpdates = true;
      }
    });

    if (!hasUpdates) {
      return null;
    }

    // Re-read immediately before commit so concurrent segment adds cannot be dropped.
    const commitBase =
      cornerstoneTools.segmentation.state.getSegmentation(segmentationId) ?? updatedSegmentation;

    const committedSegments = { ...commitBase.segments };
    for (const index of Object.keys(updatedSegmentation.segments).map(Number)) {
      const patched = updatedSegmentation.segments[index];
      if (patched) {
        committedSegments[index] = patched;
      }
    }

    cornerstoneTools.segmentation.updateSegmentations([
      {
        segmentationId,
        payload: {
          segments: committedSegments,
        },
      },
    ]);

    return {
      ...commitBase,
      segments: committedSegments,
    };
  } finally {
    // Always clear the pending flag, even on early return / throw.
    if (trackPending) {
      setSegmentsStatsPending(segmentationId, segmentIndices, false);
    }
  }
}

/**
 * Updates a segment's statistics with bidirectional measurement data
 *
 * @param segmentationId - The ID of the segmentation
 * @param segmentIndex - The index of the segment to update
 * @param bidirectionalData - The bidirectional measurement data to add
 * @param segmentationService - The segmentation service to use for updating the segment
 * @returns Whether the update was successful
 */
export function updateSegmentBidirectionalStats({
  segmentationId,
  segmentIndex,
  bidirectionalData,
  segmentationService,
  annotation,
}: {
  segmentationId: string;
  segmentIndex: number;
  bidirectionalData: BidirectionalData;
  segmentationService: AppTypes.SegmentationService;
  annotation: any;
}) {
  if (!segmentationId || segmentIndex === undefined || !bidirectionalData) {
    console.debug('Missing required data for bidirectional stats update');
    return null;
  }

  const segmentation = segmentationService.getSegmentation(segmentationId);
  if (!segmentation || !segmentation.segments[segmentIndex]) {
    console.debug('Segment not found:', segmentIndex, 'in segmentation:', segmentationId);
    return null;
  }

  const updatedSegmentation = { ...segmentation };
  const segment = updatedSegmentation.segments[segmentIndex];

  if (!segment.cachedStats) {
    segment.cachedStats = { namedStats: {} };
  }

  if (!segment.cachedStats.namedStats) {
    segment.cachedStats.namedStats = {};
  }

  const { majorAxis, minorAxis, maxMajor, maxMinor } = bidirectionalData;
  if (!majorAxis || !minorAxis) {
    console.debug('Missing major or minor axis data');
    return null;
  }

  let hasUpdates = false;
  const namedStats = segment.cachedStats.namedStats;

  // Only calculate and update if we have valid measurements
  if (maxMajor > 0 && maxMinor > 0) {
    namedStats.bidirectional = {
      name: 'bidirectional',
      label: 'Bidirectional',
      annotationUID: annotation.annotationUID,
      value: {
        maxMajor,
        maxMinor,
        majorAxis,
        minorAxis,
      },
      unit: 'mm',
    };

    hasUpdates = true;
  }

  if (hasUpdates) {
    return updatedSegmentation;
  }

  return null;
}
