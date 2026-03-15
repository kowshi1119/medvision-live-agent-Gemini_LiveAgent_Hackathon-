/**
 * AudioWorkletProcessor — captures raw PCM-16 @ context sample rate (16kHz).
 * Each process() quantum (128 samples) is posted to the main thread;
 * the main-thread setInterval batches these into 250ms chunks for Gemini.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length > 0) {
      // slice() makes a copy so the ArrayBuffer can be transferred safely
      this.port.postMessage(ch.slice());
    }
    return true; // keep processor alive indefinitely
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
