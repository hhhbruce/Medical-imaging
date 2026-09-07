// Lease-token holder for the MONAI nnInteractive session pool.
// Claims lazily on first use so idle viewers never hold a session slot;
// releases via sendBeacon on tab close (server idle-timeout is the backstop).
// Page refresh/close while an inference is running also sends a /cancel beacon
// so the backend drops the in-flight request and evicts the session instead of
// letting the orphaned prediction keep occupying the GPU/UI.

let token: string | null = null;
let claimPromise: Promise<string> | null = null;

export async function getNninterToken(): Promise<string> {
  if (token) {
    return token;
  }
  if (!claimPromise) {
    claimPromise = fetch('/monai/nninter/session/', { method: 'POST' })
      .then(r => {
        if (!r.ok) {
          throw new Error(`nninter session claim failed: HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(j => {
        token = j.token;
        return token;
      })
      .finally(() => {
        claimPromise = null;
      });
  }
  return claimPromise;
}

export function clearNninterToken(): void {
  token = null;
}

/** Ask the backend to cancel the in-flight inference on the current session.
 *  Idempotent and safe to call when nothing is running (backend no-ops). */
export function cancelNninterSession(): void {
  if (token) {
    navigator.sendBeacon(`/monai/nninter/session/${token}/cancel`);
  }
}

/** Release the session lease back to the pool. */
export function releaseNninterSession(): void {
  if (token) {
    navigator.sendBeacon(`/monai/nninter/session/${token}/release`);
  }
}

window.addEventListener('pagehide', () => {
  // Cancel first (an in-flight inference is dropped server-side), then release
  // the lease. Both endpoints are idempotent, so double-sending is harmless.
  cancelNninterSession();
  releaseNninterSession();
});
