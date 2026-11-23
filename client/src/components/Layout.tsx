import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bell,
  Bot,
  FileText,
  LayoutDashboard,
  LineChart,
  Menu,
  SlidersHorizontal,
  Upload,
  UserSearch,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Invoices & Customers", path: "/invoices", icon: FileText },
  { label: "Collections", path: "/collections", icon: Wallet },
  { label: "Cash Forecast", path: "/forecast", icon: LineChart },
  { label: "Scenario Simulator", path: "/simulator", icon: SlidersHorizontal },
  { label: "Customer Intelligence", path: "/customers", icon: UserSearch },
  { label: "AI CFO", path: "/ai-cfo", icon: Bot },
  { label: "Reminders", path: "/reminders", icon: Bell },
  { label: "Import & Analytics", path: "/import", icon: Upload },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? "bg-navy-700 text-white" : "text-slate-400 hover:text-white"
            }`
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-navy-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-navy-700 bg-navy-900 md:flex">
        <div className="px-6 py-6">
          <div className="text-lg font-bold tracking-wide text-white">CASHFLOW AI</div>
          <div className="mt-1 text-xs text-slate-400">Aarav's Printing Studio</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <NavList />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 border-b border-navy-700 bg-navy-900 md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-base font-bold tracking-wide text-white">CASHFLOW AI</div>
            <div className="text-xs text-slate-400">Aarav's Printing Studio</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            className="rounded-lg p-2 text-slate-300 hover:bg-navy-700 hover:text-white"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileOpen && (
          <div className="border-t border-navy-700 bg-navy-900 px-3 py-3">
            <NavList onNavigate={() => setMobileOpen(false)} />
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="p-4 md:ml-64 md:p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
