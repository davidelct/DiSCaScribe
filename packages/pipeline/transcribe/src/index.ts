export { parseWavHeader } from "./core/wav"
export type { WavInfo } from "./core/wav"
export { useSegmentUpload } from "./hooks/use-segment-upload"
export type { PendingSegment, UploadError } from "./hooks/use-segment-upload"

// Transcription provider (Deepgram only)
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
