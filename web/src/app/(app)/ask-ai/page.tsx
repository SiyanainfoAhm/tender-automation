import { requirePermissionStrict } from '@/server/auth/permissions';
import { GlobalChat } from '@/components/ai/global-chat';

export default async function AskAiPage() {
  await requirePermissionStrict('tenders.view');
  return <GlobalChat />;
}
