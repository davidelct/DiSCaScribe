export { parseWavHeader } from "./core/wav"
export type { WavInfo } from "./core/wav"
export { useSegmentUpload } from "./hooks/use-segment-upload"
export type { PendingSegment, UploadError } from "./hooks/use-segment-upload"

// Transcription providers
export { transcribeWavBuffer as transcribeWithWhisper } from "./providers/whisper-transcriber"
export { transcribeWavBuffer as transcribeWithWhisperLocal } from "./providers/whisper-local-transcriber"
export { transcribeWavBuffer as transcribeWithMedASR } from "./providers/medasr-transcriber"
export {
  transcribeWavBuffer as transcribeWithDeepgram,
  transcribeWavBufferDetailed as transcribeWithDeepgramDetailed,
  type DeepgramDetailedResult,
} from "./providers/deepgram-transcriber"
export {
  resolveTranscriptionProvider,
  transcribeWithResolvedProvider,
  transcribeWithResolvedProviderDetailed,
  type DetailedTranscription,
  type ResolvedTranscriptionProvider,
  type TranscriptionProvider,
  type TranscriptionRequestOptions,
} from "./providers/provider-resolver"

// Default to hosted Whisper (requires OpenAI API key)
export { transcribeWavBuffer } from "./providers/whisper-transcriber"
