import type { SVGProps } from "react";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    today: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/></>,
    plan: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></>,
    progress: <><path d="m4 16 5-5 4 4 7-8"/><path d="M15 7h5v5"/></>,
    report: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17v-3M12 17V9M16 17v-6"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 6-7"/></>,
    alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
    mistakes: <><path d="M6 3h12a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h5M8 16h7"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}
