// public/audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = [];
      this.bufferSize = 2048;
    }
  
    process(inputs) {
      const input = inputs[0];
      if (input.length > 0) {
        const pcmData = input[0];
        this.buffer.push(...pcmData);
  
        while (this.buffer.length >= this.bufferSize) {
          const chunk = this.buffer.splice(0, this.bufferSize);
          const pcm16 = new Int16Array(this.bufferSize);
          for (let i = 0; i < this.bufferSize; i++) {
            pcm16[i] = Math.max(-1, Math.min(1, chunk[i])) * 32767;
          }
          
          // This is a bit of a hack to send data back to the main thread.
          // A proper implementation would use a SharedArrayBuffer or postMessage
          // with a transferable object. For this use case, we'll convert to base64
          // in the main thread.
          this.port.postMessage(pcm16.buffer);
        }
      }
      return true;
    }
  }
  
  registerProcessor('audio-processor', AudioProcessor);
  