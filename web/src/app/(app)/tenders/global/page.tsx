import {
  TendersListPage,
  TenderExplorerSkeleton,
} from "../tenders-list-page";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GlobalTendersPage({ searchParams }: PageProps) {
  return <TendersListPage region="GLOBAL" searchParams={searchParams} />;
}

export { TenderExplorerSkeleton };
