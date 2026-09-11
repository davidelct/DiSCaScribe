import { RecallWorkspace } from "./recall-workspace"

export default async function RecallSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RecallWorkspace encounterId={id} />
}
