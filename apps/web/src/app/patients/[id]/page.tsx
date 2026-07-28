import { PatientChart } from "./patient-chart"

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PatientChart patientId={id} />
}
