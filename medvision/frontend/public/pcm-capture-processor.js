// AudioWorklet processor — captures PCM16 mono 16kHz
// Must be in /public folder so Vite serves it at root URL

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = []
    this._bufferSize = 4096  // send every 4096 samples
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true

    const samples = input[0]  // Float32Array mono channel

    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(samples[i])
    }

    // When buffer is full, convert and send
    if (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.splice(0, this._bufferSize)

      // Float32 → Int16 PCM
      const pcm16 = new Int16Array(chunk.length)
      for (let i = 0; i < chunk.length; i++) {
        const clamped = Math.max(-1, Math.min(1, chunk[i]))
        pcm16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
      }

      // Send raw buffer to main thread (transfer ownership for zero-copy)
      this.port.postMessage({ pcm16: pcm16.buffer }, [pcm16.buffer])
    }

    return true  // keep processor alive
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor)
