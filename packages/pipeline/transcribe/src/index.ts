export { parseWavHeader } from "./core/wav"
export type { WavInfo } from "./core/wav"
export { useSegmentUpload } from "./hooks/use-segment-upload"
export type { PendingSegment, UploadError } from "./hooks/use-segment-upload"

// Word-level confidence, as offsets into the rendered transcript.
export {
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  isLowConfidence,
  type TranscriptWordSpan,
} from "../../shared/src/transcript"

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
