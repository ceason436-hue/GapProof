import { AppShell } from "@/components/app-shell";
import { SyntheticQuickCheck } from "@/components/synthetic-quick-check";

export default function QuickCheckPage() {
  return <AppShell actionHref="#quick-check" actionLabel="继续三题检查"><section className="quick-check-page" id="quick-check"><SyntheticQuickCheck/></section></AppShell>;
}
