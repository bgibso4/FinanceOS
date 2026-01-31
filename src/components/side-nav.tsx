'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/analytics', label: 'Analytics' },
  {
    href: '/transactions',
    label: 'Transactions',
    submenu: [
      { href: '/transactions?tab=all', label: 'All Transactions' },
      { href: '/transactions?tab=review', label: 'Review Queue' },
      { href: '/transactions?tab=subscriptions', label: 'Subscriptions' },
    ],
  },
  {
    href: '/reports',
    label: 'Reports',
    submenu: [
      { href: '/reports?tab=net-worth', label: 'Net Worth' },
      { href: '/reports?tab=cash-flow', label: 'Cash Flow' },
      { href: '/reports?tab=monthly', label: 'Monthly Detail' },
    ],
  },
  {
    href: '/settings',
    label: 'Settings',
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

export function SideNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'general';

  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(
    new Set([
      ...(pathname.startsWith('/settings') ? ['/settings'] : []),
      ...(pathname.startsWith('/transactions') ? ['/transactions'] : []),
      ...(pathname.startsWith('/reports') ? ['/reports'] : []),
    ])
  );

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

  return (
    <aside className="hidden w-52 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 px-4 py-6 md:flex md:flex-col md:gap-4">
      <div className="mb-2">
        <Image
          priority
          alt="FinanceOS"
          className="dark:brightness-110"
          height={44}
          src="/images/logo-full.png"
          width={176}
        />
      </div>
      <div className="flex flex-col gap-1">
        {links.map((link) => {
          const isActive = link.submenu ? pathname.startsWith(link.href) : pathname === link.href;
          const isExpanded = expandedMenus.has(link.href);

          return (
            <div key={link.href} className="mb-2">
              {link.submenu ? (
                <>
                  <button
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-sm font-semibold transition flex items-center justify-between',
                      isActive
                        ? 'bg-slate-900 dark:bg-slate-700 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    )}
                    onClick={() => toggleMenu(link.href)}
                  >
                    <span>{link.label}</span>
                    <svg
                      className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-90')}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M9 5l7 7-7 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                      />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="ml-3 mt-1 flex flex-col gap-1 border-l-2 border-slate-200 dark:border-slate-700 pl-2">
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
                              'rounded-lg px-3 py-1.5 text-sm transition',
                              isSubmenuActive
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white font-medium'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            )}
                            href={sublink.href}
                          >
                            {sublink.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <Link
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-semibold transition',
                    isActive
                      ? 'bg-slate-900 dark:bg-slate-700 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  )}
                  href={link.href}
                >
                  {link.label}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
