'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  ChevronRight,
  FileText,
  LayoutGrid,
  List,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Sparkles,
  Sun,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/cn';

import type { LucideIcon } from 'lucide-react';

const links: NavLink[] = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  {
    href: '/transactions',
    label: 'Transactions',
    icon: List,
    submenu: [
      { href: '/transactions?tab=all', label: 'All Transactions' },
      { href: '/transactions?tab=review', label: 'Review Queue' },
      { href: '/transactions?tab=subscriptions', label: 'Subscriptions' },
    ],
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: FileText,
    submenu: [
      { href: '/reports?tab=net-worth', label: 'Net Worth' },
      { href: '/reports?tab=cash-flow', label: 'Cash Flow' },
      { href: '/reports?tab=monthly', label: 'Monthly Detail' },
    ],
  },
  { href: '/goals', label: 'Goals', icon: Target },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    submenu: [
      { href: '/settings?tab=accounts', label: 'Accounts' },
      { href: '/settings?tab=budgets', label: 'Budgets' },
      { href: '/settings?tab=categories', label: 'Categories' },
      { href: '/settings?tab=general', label: 'General' },
      { href: '/settings?tab=import', label: 'Import' },
      { href: '/settings?tab=rules', label: 'Rules' },
      { href: '/settings?tab=tags', label: 'Tags' },
      { href: '/settings?tab=sync', label: 'Cloud Sync' },
    ],
  },
];

type SubLink = {
  href: string;
  label: string;
};

type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  submenu?: SubLink[];
};

type SideNavProps = {
  onToggleAnalyst?: () => void;
};

export function SideNav({ onToggleAnalyst }: SideNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'general';

  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-expanded') === 'true';
    }
    return false;
  });

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(
    new Set([
      ...(pathname.startsWith('/settings') ? ['/settings'] : []),
      ...(pathname.startsWith('/transactions') ? ['/transactions'] : []),
      ...(pathname.startsWith('/reports') ? ['/reports'] : []),
    ])
  );

  const toggleSidebar = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-expanded', String(next));
      return next;
    });
  };

  const toggleMenu = (href: string) => {
    setExpandedMenus((prev) => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  };

  const toggleTheme = () => {
    const html = document.documentElement;
    const currentlyDark = html.classList.contains('dark');
    if (currentlyDark) {
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setIsDark(false);
    } else {
      html.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setIsDark(true);
    }
  };

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col shrink-0 h-screen sticky top-0',
        'bg-[var(--bg-surface)] border-r border-[var(--border)]',
        'transition-all duration-[250ms] ease-[ease]'
      )}
      style={{ width: isExpanded ? 200 : 56, minWidth: isExpanded ? 200 : 56 }}
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-3 shrink-0">
        {isExpanded ? (
          <span className="text-[var(--text-primary)] font-semibold text-base whitespace-nowrap overflow-hidden">
            FinanceOS
          </span>
        ) : (
          <span className="flex items-center justify-center w-9 h-9 text-[var(--text-primary)] font-medium text-base">
            F
          </span>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col gap-0.5 px-2 overflow-y-auto overflow-x-hidden">
        {links.map((link) => {
          const isActive = link.submenu ? pathname.startsWith(link.href) : pathname === link.href;
          const isMenuExpanded = expandedMenus.has(link.href);
          const Icon = link.icon;

          return (
            <div key={link.href}>
              {/* Nav item */}
              {link.submenu && isExpanded ? (
                <button
                  className={cn(
                    'relative flex items-center gap-2 w-full rounded-lg transition-all duration-[250ms] ease-[ease]',
                    isExpanded ? 'px-2 py-2' : 'justify-center p-0 w-9 h-9 mx-auto',
                    isActive
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  )}
                  onClick={() => toggleMenu(link.href)}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[var(--accent)] rounded-r" />
                  )}
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0">
                    <Icon size={18} />
                  </span>
                  {isExpanded && (
                    <>
                      <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
                        {link.label}
                      </span>
                      <ChevronRight
                        className={cn(
                          'ml-auto shrink-0 transition-transform duration-[250ms] ease-[ease]',
                          isMenuExpanded && 'rotate-90'
                        )}
                        size={14}
                      />
                    </>
                  )}
                </button>
              ) : (
                <Link
                  className={cn(
                    'relative flex items-center gap-2 rounded-lg transition-all duration-[250ms] ease-[ease]',
                    isExpanded ? 'px-2 py-2' : 'justify-center p-0 w-9 h-9 mx-auto',
                    isActive
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  )}
                  href={link.href}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[var(--accent)] rounded-r" />
                  )}
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0">
                    <Icon size={18} />
                  </span>
                  {isExpanded && (
                    <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
                      {link.label}
                    </span>
                  )}
                  {isExpanded && link.submenu && (
                    <ChevronRight className="ml-auto shrink-0" size={14} />
                  )}
                </Link>
              )}

              {/* Submenu (expanded sidebar only) */}
              {isExpanded && link.submenu && isMenuExpanded && (
                <div className="ml-6 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
                  {link.submenu.map((sublink) => {
                    const sublinkTab = sublink.href.includes('?tab=')
                      ? sublink.href.split('?tab=')[1]
                      : null;
                    const isSubmenuActive =
                      pathname === link.href &&
                      (sublinkTab ? currentTab === sublinkTab : !currentTab);

                    return (
                      <Link
                        key={sublink.href}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs transition-all duration-[250ms] ease-[ease] whitespace-nowrap overflow-hidden',
                          isSubmenuActive
                            ? 'text-[var(--accent)] font-medium'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        )}
                        href={sublink.href}
                      >
                        {sublink.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-0.5 px-2 pb-3 pt-2 border-t border-[var(--border)] mt-1">
        {/* Theme toggle */}
        <button
          className={cn(
            'relative flex items-center gap-2 rounded-lg transition-all duration-[250ms] ease-[ease]',
            isExpanded ? 'px-2 py-2' : 'justify-center p-0 w-9 h-9 mx-auto',
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
          onClick={toggleTheme}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </span>
          {isExpanded && (
            <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
              {isDark ? 'Light Mode' : 'Dark Mode'}
            </span>
          )}
        </button>

        {/* AI Analyst */}
        {onToggleAnalyst && (
          <button
            className={cn(
              'relative flex items-center gap-2 rounded-lg transition-all duration-[250ms] ease-[ease]',
              isExpanded ? 'px-2 py-2' : 'justify-center p-0 w-9 h-9 mx-auto',
              'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            )}
            onClick={onToggleAnalyst}
          >
            <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0">
              <Sparkles size={18} />
            </span>
            {isExpanded ? (
              <>
                <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
                  Finance Analyst
                </span>
                <kbd className="ml-auto rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] shrink-0">
                  ⌘K
                </kbd>
              </>
            ) : (
              <span className="font-mono text-[9px] opacity-50 absolute -bottom-0.5 left-1/2 -translate-x-1/2">
                ⌘K
              </span>
            )}
          </button>
        )}

        {/* Expand/Collapse toggle */}
        <button
          className={cn(
            'relative flex items-center gap-2 rounded-lg transition-all duration-[250ms] ease-[ease]',
            isExpanded ? 'px-2 py-2' : 'justify-center p-0 w-9 h-9 mx-auto',
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
          onClick={toggleSidebar}
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0">
            {isExpanded ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </span>
          {isExpanded && (
            <span className="text-sm font-medium whitespace-nowrap overflow-hidden">Collapse</span>
          )}
        </button>
      </div>
    </aside>
  );
}
