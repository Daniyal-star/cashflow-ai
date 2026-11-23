import { EmptyState } from "../components/States";

export default function ComingSoon({ title }: { title: string }) {
  return <EmptyState title={title} body="This module is scheduled for a later milestone." />;
}
