#!/bin/bash
# One-shot script: download model weights into monai-label/checkpoints/
# Run once before `docker compose up`: bash scripts/download_weights.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECKPOINTS_DIR="$REPO_ROOT/monai-label/checkpoints"
mkdir -p "$CHECKPOINTS_DIR"

SAM2_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"
MEDSAM2_URL="https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_latest.pt"

_download_public_weight() {
    local name="$1"
    local url="$2"
    local target="$3"
    if [ -f "$target" ]; then
        echo "[weights] $name already present: $target"
        return
    fi

    echo "[weights] Downloading $name to $target ..."
    wget --quiet --show-progress --output-document "${target}.part" "$url"
    mv "${target}.part" "$target"
}

_download_public_weight "SAM2.1" "$SAM2_URL" "$CHECKPOINTS_DIR/sam2.1_hiera_tiny.pt"
_download_public_weight "MedSAM2" "$MEDSAM2_URL" "$CHECKPOINTS_DIR/MedSAM2_latest.pt"

echo "[weights] Checkpoints directory: $CHECKPOINTS_DIR"
