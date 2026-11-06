/** Playback of saved clips never calls a speech provider. */
export function createPreparedNarrator({ getRecord, onStatus = () => {}, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext }) {
  let context;
  const decoded = new Map();
  return {
    startTimeout: 10000,
    async enable() {
      if (!AudioContextClass) throw new Error('Audio is unavailable in this browser.');
      if (!context || context.state === 'closed') context = new AudioContextClass();
      await context.resume();
      onStatus('Saved guide ready. No AI requests are made during playback.');
    },
    speak(_text, _language, { landmark, offset = 0, onStart, onEnd, onError }) {
      let cancelled = false;
      let source;
      const record = getRecord();
      const clip = record?.clips[landmark.id];
      const play = async () => {
        if (!context || context.state !== 'running') throw new Error('Enable guide audio in the Tour guide menu.');
        if (!clip) throw new Error('This saved audio clip is missing. Open the route guide to restore or generate it.');
        const key = `${record.guide.id}:${landmark.id}`;
        if (!decoded.has(key)) decoded.set(key, clip.arrayBuffer().then(data => context.decodeAudioData(data)));
        const buffer = await decoded.get(key);
        if (cancelled) return;
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => { source.disconnect(); if (!cancelled) onEnd(); };
        source.start(0, Math.min(offset, Math.max(0, buffer.duration - .01)));
        onStart({ duration: buffer.duration });
      };
      play().catch(error => { if (!cancelled) onError(`${error.message} Showing subtitles instead.`); });
      return () => { cancelled = true; if (source) { source.onended = null; source.stop(); source.disconnect(); } };
    },
    dispose() { decoded.clear(); context?.close(); },
  };
}
