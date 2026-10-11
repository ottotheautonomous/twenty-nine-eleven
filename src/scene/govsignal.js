// Governor signals that only the GL context can give: our own GPU time per frame (EXT_disjoint_timer_query_webgl2, desktop
// Chromium) and, where that is missing, how many frames the GPU runs behind (a fence after each draw). Both are polled, never waited on.
export function createGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const POOL = 8, free = [], pending = [];          // results arrive 1-4 frames late; a full pool drops the sample, never blocks
  let open = false;
  return {
    begin(at) {
      if (open || pending.length >= POOL || gl.isContextLost()) return;
      const q = free.pop() || gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q); open = true; pending.push({ q, at });
    },
    end() { if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); open = false; } },
    poll(out = []) {                                 // finished samples [{ at, ms }], oldest first; a disjoint event voids everything in flight
      if (gl.isContextLost()) return out;
      while (pending.length) {
        const { q, at } = pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        free.push(q);
        if (disjoint) { pending.forEach((p) => free.push(p.q)); pending.length = 0; out.length = 0; break; }
        out.push({ at, ms: ns / 1e6 });
      }
      return out;
    },
    dispose() {
      if (!gl.isContextLost()) { pending.forEach((p) => gl.deleteQuery(p.q)); free.forEach((q) => gl.deleteQuery(q)); }
      pending.length = free.length = 0;
    },
  };
}

export function createFenceLag(gl) {
  let sync = null, frames = 0;
  return {
    mark() { if (!sync && !gl.isContextLost()) { sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); frames = 0; } },   // after a draw
    tick() {                                         // before the next draw: the lag in frames when the fence signals, else -1
      if (!sync || gl.isContextLost()) return -1;
      frames++;
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) return -1;
      gl.deleteSync(sync); sync = null; return frames;
    },
    dispose() { if (sync && !gl.isContextLost()) gl.deleteSync(sync); sync = null; },
  };
}
