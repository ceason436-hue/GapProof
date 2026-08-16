import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ taskId: string }> };

export default async function MistakeTaskPage({ params }: PageProps) {
  const { taskId } = await params;
  redirect(`/student/tasks/${encodeURIComponent(taskId)}`);
}
