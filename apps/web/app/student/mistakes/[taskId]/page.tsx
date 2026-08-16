import { MistakeBookTask } from "@/components/mistake-book";

type PageProps = { params: Promise<{ taskId: string }> };

export default async function MistakeTaskPage({ params }: PageProps) {
  const { taskId } = await params;
  return <MistakeBookTask taskId={taskId}/>;
}
