import { CaseRecognitionReview } from "@/components/case-recognition-review";

export const dynamic = "force-dynamic";

type CaseReviewPageProps = {
  params: Promise<{ caseId: string }>;
};

export default async function CaseReviewPage({ params }: CaseReviewPageProps) {
  const { caseId } = await params;
  return <CaseRecognitionReview caseId={caseId}/>;
}
