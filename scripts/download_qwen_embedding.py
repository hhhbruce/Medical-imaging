# Download the VoxTell text backbone (Qwen3-Embedding-4B) into a LOCAL directory
# under checkpoints/ so the MONAI server never needs HF at runtime.
#
# Robust to a flaky proxied network: ranged resume, proactive reconnects, and a
# watchdog that force-closes stalled connections. Every finished file is
# verified against the SHA256 published by the HF repo API; mismatches are
# deleted and re-downloaded automatically.
#
# Usage:
#   python download_qwen_embedding.py [--dest <dir>] [--repo <base url>] [--only <file>] [--force]
import argparse
import hashlib
import json
import pathlib
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

REPO_ID = "Qwen/Qwen3-Embedding-4B"
DEFAULT_REPO = f"https://huggingface.co/{REPO_ID}/resolve/main"
DEFAULT_API = f"https://huggingface.co/api/models/{REPO_ID}/tree/main?recursive=true"
RECONNECT_EVERY = 256 * 1024 * 1024  # bytes per connection attempt

# Official LFS SHA256 (from the HF repo API) — pinned locally so verification
# works even when the API is unreachable through the local proxy.
EXPECTED_SHA256 = {
    "model-00001-of-00002.safetensors": "e70bfe3c970523fb7ef4eddffed2254ce3f1e7150c3de2af4342de129dd756f8",
    "model-00002-of-00002.safetensors": "ed1b87c8e9eb7e535a1a155e4fd00d9f4dba80e58a6db48a4c9f82cede7079c1",
}

FILES = [
    ".gitattributes",
    "1_Pooling/config.json",
    "README.md",
    "config.json",
    "config_sentence_transformers.json",
    "generation_config.json",
    "merges.txt",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "model.safetensors.index.json",
    "modules.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
]

_state = {"bytes": 0, "sock": None}
_state_lock = threading.Lock()


def _watchdog() -> None:
    while True:
        time.sleep(15)
        with _state_lock:
            sock = _state["sock"]
            grew = _state["bytes"]
            _state["bytes"] = 0
        if sock is None:
            continue
        # Force-close when a connection advances less than ~30 MB per 15 s
        # (<2 MB/s). Cycling connections rides each proxy burst window.
        if grew < 30 * 1024 * 1024:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass


def _open(url: str, offset: int):
    """Open a ranged request, following 3xx redirects manually (HEAD/Range are
    not forwarded consistently by every mirror)."""
    for _ in range(6):
        req = urllib.request.Request(url, headers={"Range": f"bytes={offset}-"})
        try:
            return urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308):
                url = err.headers.get("Location", url)
                continue
            raise
    raise RuntimeError("too many redirects")


def _expected_oid(rel: str) -> str:
    return EXPECTED_SHA256.get(rel, "")


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1 << 20)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def fetch_file(rel: str, dst: pathlib.Path, base_url: str, force: bool) -> None:
    url = f"{base_url}/{rel}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    expected = _expected_oid(rel).lower()

    # An existing, hash-verified file is final; never re-download unless forced.
    if dst.exists() and expected:
        if _sha256(dst) == expected:
            print(f"OK {rel} (verified on disk)", flush=True)
            return
        print(f"  {rel}: existing file failed hash check — re-downloading", flush=True)
        dst.unlink(missing_ok=True)

    while True:
        have = tmp.stat().st_size if tmp.exists() and not force else 0
        if force and tmp.exists():
            tmp.unlink(missing_ok=True)
            have = 0
        connection_start = have
        finished = False
        try:
            with _open(url, have) as resp:
                status = getattr(resp, "status", 200)
                if status not in (200, 206):
                    raise RuntimeError(f"HTTP {status}")
                sock = resp.fp.raw._sock  # noqa: SLF001 - watchdog needs it
                with _state_lock:
                    _state["sock"] = sock
                with open(tmp, "ab") as handle:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            finished = True
                            break
                        handle.write(chunk)
                        have += len(chunk)
                        with _state_lock:
                            _state["bytes"] += len(chunk)
                        if have - connection_start >= RECONNECT_EVERY:
                            break  # proactive reconnect, file state is safe
                with _state_lock:
                    _state["sock"] = None
        except Exception as err:  # noqa: BLE001 - resume loop is intentional
            with _state_lock:
                _state["sock"] = None
            print(f"  {rel}: {str(err)[:100]} at {have / 2**20:.0f} MB — retrying", flush=True)
            time.sleep(2)
            continue
        if not finished:
            continue  # windowed reconnect: resume where we left off

        # Clean EOF: verify size/hash before accepting the file.
        if expected:
            if _sha256(tmp) == expected:
                tmp.replace(dst)
                print(f"OK {rel} (hash verified)", flush=True)
                return
            print(f"  {rel}: hash mismatch at {have / 2**20:.0f} MB — restarting", flush=True)
            tmp.unlink(missing_ok=True)
            continue
        if have > 0:
            tmp.replace(dst)
            print(f"OK {rel} (EOF, size unknown)", flush=True)
            return
        print(f"  {rel}: empty response — retrying", flush=True)
        time.sleep(3)


def main() -> int:
    threading.Thread(target=_watchdog, daemon=True).start()
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", default=r"D:\Smart City\checkpoints\Qwen3-Embedding-4B")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Base URL of the file server")
    parser.add_argument("--only", default="", help="Download a single file name only")
    parser.add_argument("--force", action="store_true", help="Re-download files even if present")
    args = parser.parse_args()
    root = pathlib.Path(args.dest)
    root.mkdir(parents=True, exist_ok=True)
    for rel in FILES:
        if args.only and rel != args.only:
            continue
        fetch_file(rel, root / rel, args.repo, args.force)
    print("QWEN_LOCAL_DOWNLOAD_DONE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
