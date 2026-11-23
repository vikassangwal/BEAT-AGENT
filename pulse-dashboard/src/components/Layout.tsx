import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button, IconButton } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import {
  LayoutDashboard,
  Settings,
  Shield,
  Users,
  Key,
  FileText,
  Globe,
  Server,
  Activity,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Bell,
  Search,
  HelpCircle,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    children: [
      { name: 'General', href: '/settings/general' },
      { name: 'SSO', href: '/settings/sso' },
      { name: 'SCIM', href: '/settings/scim' },
    ],
  },
  {
    name: 'Security',
    href: '/security',
    icon: Shield,
    children: [
      { name: 'Audit Logs', href: '/security/audit-logs' },
      { name: 'RBAC', href: '/security/rbac' },
      { name: 'Secrets', href: '/security/secrets' },
      { name: 'Compliance', href: '/security/compliance' },
      { name: 'IP Allowlist', href: '/security/ip-allowlist' },
      { name: 'Sessions', href: '/security/sessions' },
      { name: 'Devices', href: '/security/devices' },
    ],
  },
];

export function Layout() {
  const { user, workspace, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(href + '/');

  const isParentActive = (parentHref: string) => {
    const parentPaths = navigation.find(n => n.href === parentHref)?.children?.map(c => c.href) || [];
    return parentPaths.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
  };

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-950">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-secondary-900 border-r border-secondary-200 dark:border-secondary-700 transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main navigation"
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center h-16 px-6 border-b border-secondary-200 dark:border-secondary-700">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-secondary-900 dark:text-white">Pulse</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Navigation">
            {navigation.map((item) => {
              const hasChildren = item.children && item.children.length > 0;
              const isExpanded = expandedMenu === item.href;
              const active = isActive(item.href) || (hasChildren && isParentActive(item.href));

              return (
                <div key={item.href}>
                  {hasChildren ? (
                    <>
                      <button
                        onClick={() => setExpandedMenu(isExpanded ? null : item.href)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          active
                            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                            : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                        }`}
                        aria-expanded={isExpanded}
                        aria-controls={`submenu-${item.href}`}
                      >
                        <div className="flex items-center gap-3">
                          <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.name}</span>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                      <div
                        id={`submenu-${item.href}`}
                        className={`overflow-hidden transition-all duration-200 ${
                          isExpanded ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'
                        }`}
                        role="region"
                        aria-label={`${item.name} submenu`}
                      >
                        <ul className="mt-1 ml-8 space-y-0.5" role="list">
                          {item.children!.map((child) => (
                            <li key={child.href}>
                              <NavLink
                                to={child.href}
                                className={({ isActive }) =>
                                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    isActive
                                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                                      : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                                  }`
                                }
                              >
                                {child.name}
                              </NavLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : (
                    <NavLink
                      to={item.href}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                            : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                        }`
                      }
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.name}</span>
                    </NavLink>
                  )}
                </div>
              );
            })}
          </nav>

          {/* User section */}
          <div className="p-3 border-t border-secondary-200 dark:border-secondary-700">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                ) : (
                  <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                    {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-secondary-500 dark:text-secondary-400 truncate">
                  {workspace?.name || 'No workspace'}
                </p>
              </div>
              <IconButton
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label="User menu"
                aria-expanded={userMenuOpen}
              >
                <ChevronDown className="w-4 h-4" />
              </IconButton>
            </div>

            {/* User dropdown */}
            {userMenuOpen && (
              <div className="dropdown mt-2">
                <div className="px-3 py-2 border-b border-secondary-200 dark:border-secondary-700">
                  <p className="text-xs font-medium text-secondary-500 dark:text-secondary-400">Account</p>
                </div>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/settings/general');
                  }}
                  className="dropdown-item"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
                <div className="dropdown-divider" />
                <button onClick={handleLogout} className="dropdown-item text-danger-600 dark:text-danger-400">
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/80 dark:bg-secondary-950/80 backdrop-blur-sm border-b border-secondary-200 dark:border-secondary-700">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>

            {/* Workspace switcher */}
            <div className="flex-1 lg:flex-none">
              <div className="relative">
                <button
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800 rounded-lg"
                  onClick={() => {}} // Would open workspace switcher
                >
                  <Globe className="w-4 h-4" />
                  <span className="truncate max-w-[200px]">{workspace?.name || 'Select workspace'}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="hidden sm:block relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                <input
                  type="search"
                  placeholder="Search..."
                  className="input pl-10 pr-4 w-64 bg-secondary-100 dark:bg-secondary-800 border-transparent focus:bg-white dark:focus:bg-secondary-900"
                  aria-label="Search"
                />
              </div>

              {/* Notifications */}
              <IconButton aria-label="Notifications">
                <Bell className="w-5 h-5" />
              </IconButton>

              {/* Help */}
              <IconButton aria-label="Help">
                <HelpCircle className="w-5 h-5" />
              </IconButton>

              {/* User avatar */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-800"
                  aria-label="User menu"
                  aria-expanded={userMenuOpen}
                >
                  <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                        {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <ChevronDown className="w-4 h-4 text-secondary-500 hidden sm:block" />
                </button>

                {userMenuOpen && (
                  <div className="dropdown right-0 mt-2 w-48">
                    <div className="px-4 py-3 border-b border-secondary-200 dark:border-secondary-700">
                      <p className="text-sm font-medium text-secondary-900 dark:text-white">{user?.name}</p>
                      <p className="text-xs text-secondary-500 dark:text-secondary-400 truncate">{user?.email}</p>
                    </div>
                    <NavLink
                      to="/settings/general"
                      onClick={() => setUserMenuOpen(false)}
                      className="dropdown-item"
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </NavLink>
                    <div className="dropdown-divider" />
                    <button onClick={handleLogout} className="dropdown-item text-danger-600 dark:text-danger-400 w-full text-left">
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8" role="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}