import { QuestionArchiveDetail } from "@/components/mistake-book";

type PageProps = { params: Promise<{ entryRef: string }> };

export default async function QuestionArchivePage({ params }: PageProps) {
  const { entryRef } = await params;
  return <QuestionArchiveDetail entryRef={decodeURIComponent(entryRef)}/>;
}
