import type { ReactNode } from "react";
import { ProjectNav } from "@/components/project-nav";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <ProjectNav projectId={id} />
      {children}
    </>
  );
}
