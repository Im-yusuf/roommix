// The AudioWorklet global scope is not part of TypeScript's DOM library.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
/** Sample rate of the AudioContext this worklet runs in. */
declare const sampleRate: number;
