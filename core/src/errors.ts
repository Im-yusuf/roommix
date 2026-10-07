export type MixerErrorCode =
  | 'invalid_sample_rate'
  | 'invalid_channels'
  | 'duplicate_source'
  | 'unknown_source'
  | 'invalid_chunk'
  | 'chunk_too_large'
  | 'unknown_strategy';

/** Thrown for caller mistakes and malformed input. The code is stable; the message is for humans. */
export class MixerError extends Error {
  readonly code: MixerErrorCode;

  constructor(code: MixerErrorCode, message: string) {
    super(message);
    this.name = 'MixerError';
    this.code = code;
  }
}
