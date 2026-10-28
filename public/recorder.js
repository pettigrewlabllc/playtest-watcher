// Capture helpers shared by spike.html and record.html. Exposes window.PW.
(() => {
  const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const AUDIO_MIME = ['audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m));

  async function listDevices() {
    // Labels are empty until the page has had camera and mic permission once.
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    probe.getTracks().forEach(t => t.stop());
    const all = await navigator.mediaDevices.enumerateDevices();
    return { cameras: all.filter(d => d.kind === 'videoinput'), mics: all.filter(d => d.kind === 'audioinput') };
  }

  const openCamera = (deviceId, { width, height, fps }) => navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } },
    audio: false,
  });

  const openMic = deviceId => navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    video: false,
  });

  const openScreen = () => navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });

  const RETRY_DELAYS_MS = [500, 1000, 2000];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // One chunk, retried 3 times with backoff before it counts as failed.
  async function uploadChunk(url, body, sleep) {
    let last;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } });
        if (r.ok) return;
        last = new Error(`status ${r.status}`);
      } catch (err) { last = err; }
    }
    throw last;
  }

  // opts.onFail(trackName, error) fires once, as soon as a chunk is given up on, so the page can warn while recording.
  function startTrackRecorder(sessionId, trackName, stream, opts = {}) {
    const sleep = opts.sleep || wait;
    const audioOnly = stream.getVideoTracks().length === 0;
    const rec = new MediaRecorder(stream, { mimeType: audioOnly ? AUDIO_MIME : MIME });
    let seq = 0, bytes = 0, chain = Promise.resolve(), failed = null;
    const startedAt = Date.now();
    rec.ondataavailable = e => {
      if (!e.data.size) return;
      const n = seq++;
      bytes += e.data.size;
      // Chunks must arrive in order, so uploads are chained. Once one is lost the server can't take later ones.
      chain = chain.then(() => {
        if (failed) return;
        return uploadChunk(`/api/sessions/${sessionId}/chunk?track=${trackName}&seq=${n}`, e.data, sleep)
          .catch(err => {
            failed = new Error(`${trackName} chunk ${n}: ${err && err.message}`);
            if (opts.onFail) opts.onFail(trackName, failed);
          });
      });
    };
    rec.start(1000);
    return {
      startedAt,
      mimeType: rec.mimeType,
      stats: () => ({ chunks: seq, bytes, error: failed && String(failed.message) }),
      stop: () => new Promise(resolve => {
        rec.onstop = () => chain.then(resolve);
        rec.stop();
      }),
    };
  }

  function frameCounter(video) {
    // Counts frames actually presented, to catch a camera that silently stalls.
    let total = 0, windowFrames = 0, last = performance.now(), fps = 0;
    const tick = () => {
      total++; windowFrames++;
      const now = performance.now();
      if (now - last >= 1000) { fps = windowFrames * 1000 / (now - last); windowFrames = 0; last = now; }
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
    return { fps: () => fps, total: () => total };
  }

  window.PW = { listDevices, openCamera, openMic, openScreen, startTrackRecorder, frameCounter, MIME, AUDIO_MIME };
})();
