import { Suspense, type ReactNode } from "react";
import { ProjectNav } from "@/components/project-nav";

async function Nav({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectNav projectId={id} />;
}

export default function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <Suspense>
        <Nav params={params} />
      </Suspense>
      {children}
    </>
  );
}
