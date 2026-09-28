import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "今日", icon: "🏠", end: true },
  { to: "/chores", label: "家事", icon: "🧹", end: false },
  { to: "/history", label: "履歴", icon: "📜", end: false },
  { to: "/settings", label: "設定", icon: "⚙️", end: false },
];

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <main className="app-main">{children}</main>
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              "bottom-nav-item" + (isActive ? " bottom-nav-item--active" : "")
            }
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
