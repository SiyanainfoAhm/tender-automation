import {
  TendersListPage,
  TenderExplorerSkeleton,
} from "../tenders-list-page";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IndianTendersPage({ searchParams }: PageProps) {
  return <TendersListPage region="INDIAN" searchParams={searchParams} />;
}

export { TenderExplorerSkeleton };
