import { AppShell } from "@/components/app-shell";
import { DemoRecognitionReview, type DemoReviewMode } from "@/components/demo-recognition-review";

type ReviewPageProps = {
  searchParams?: Promise<{ state?: string | string[] }>;
};

function resolveMode(state: string | string[] | undefined): DemoReviewMode {
  const value = Array.isArray(state) ? state[0] : state;
  return value === "empty" || value === "error" ? value : "review";
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params: { state?: string | string[] } = searchParams ? await searchParams : {};
  return <AppShell actionHref="/materials/new" actionLabel="重新上传材料">
    <DemoRecognitionReview mode={resolveMode(params.state)} />
  </AppShell>;
}
