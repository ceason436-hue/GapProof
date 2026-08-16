import { StudentTask } from "@/components/mistake-book";

type PageProps = { params: Promise<{ taskId: string }> };

export default async function StudentTaskPage({ params }: PageProps) {
  const { taskId } = await params;
  return <StudentTask taskId={taskId}/>;
}
