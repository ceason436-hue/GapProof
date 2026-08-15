import { AppShell } from "@/components/app-shell";
import { SyntheticQuickCheck } from "@/components/synthetic-quick-check";

export default function QuickCheckPage() {
  return <AppShell actionDisabled actionLabel="完成三题检查"><section className="quick-check-page"><SyntheticQuickCheck/></section></AppShell>;
}
