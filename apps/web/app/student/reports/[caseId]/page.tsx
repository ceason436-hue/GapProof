import { StudentReportDetail } from "@/components/student-progress-report";

type PageProps = { params: Promise<{ caseId: string }> };

export default async function StudentReportDetailPage({ params }: PageProps) {
  const { caseId } = await params;
  return <StudentReportDetail caseId={caseId}/>;
}
