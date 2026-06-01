import { NextResponse } from "next/server"
import { resolveTranscriptionProvider } from "@transcription"

export const runtime = "nodejs"

export async function GET() {
  const { provider, model } = resolveTranscriptionProvider()
  return NextResponse.json({ provider, model })
}
