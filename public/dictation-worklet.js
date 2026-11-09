// The microphone, in the audio thread (public/dictation.js): hands the page each little block of
// sound (128 samples) as it comes.
class DictationCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor('dictation-capture', DictationCapture);
