import { ConsultationWorkspace } from "./consultation-workspace"

export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ConsultationWorkspace encounterId={id} />
}
