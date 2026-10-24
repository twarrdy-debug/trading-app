import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client.ts';
import { ActivatePage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, UnsubscribePage } from './features/auth/AuthPages.tsx';
import { I18nProvider } from './i18n/index.tsx';
import { LandingPage } from './features/landing/LandingPage.tsx';
import './styles.css';

/**
 * The app's screens load on demand, so the public page and sign-in fetch only their own code
 * (faster first visit, which search engines also measure).
 */
const AppShell = lazyRouteComponent(() => import('./layout/AppShell.tsx'), 'AppShell');
const ComingSoon = lazyRouteComponent(() => import('./layout/AppShell.tsx'), 'ComingSoon');
const CalculatorPage = lazyRouteComponent(() => import('./features/calculator/CalculatorPage.tsx'), 'CalculatorPage');
const CalendarPage = lazyRouteComponent(() => import('./features/calendar/CalendarPage.tsx'), 'CalendarPage');
const NewsPage = lazyRouteComponent(() => import('./features/news/NewsPage.tsx'), 'NewsPage');
const SettingsPage = lazyRouteComponent(() => import('./features/settings/SettingsPage.tsx'), 'SettingsPage');
const StatsPage = lazyRouteComponent(() => import('./features/stats/StatsPage.tsx'), 'StatsPage');
const AdminPage = lazyRouteComponent(() => import('./features/admin/AdminPage.tsx'), 'AdminPage');
const AnalysisPage = lazyRouteComponent(() => import('./features/analysis/AnalysisPage.tsx'), 'AnalysisPage');
const StrategiesPage = lazyRouteComponent(() => import('./features/analysis/AnalysisPage.tsx'), 'StrategiesPage');
const BacktestPage = lazyRouteComponent(() => import('./features/backtest/BacktestPage.tsx'), 'BacktestPage');
const DashboardPage = lazyRouteComponent(() => import('./features/dashboard/DashboardPage.tsx'), 'DashboardPage');
const TradesPage = lazyRouteComponent(() => import('./features/trades/TradesPage.tsx'), 'TradesPage');

const rootRoute = createRootRoute();

/** The signed-in app: everything inside the shell (header, navigation), which checks the session. */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppShell });

const routeTree = rootRoute.addChildren([
  // The public page is the bare address, for everyone; `/start` (its old address) still leads there.
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: LandingPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    beforeLoad: () => {
      throw redirect({ to: '/', replace: true });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/logowanie', component: LoginPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/rejestracja', component: RegisterPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/reset-hasla', component: ForgotPasswordPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/nowe-haslo', component: ResetPasswordPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/aktywacja', component: ActivatePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/wypisz', component: UnsubscribePage }),
  appRoute.addChildren([
    createRoute({ getParentRoute: () => appRoute, path: '/dashboard', component: DashboardPage }),
    // The journal page was a trimmed copy of the statistics (removed 2026-10-24): old links open Trades.
    createRoute({
      getParentRoute: () => appRoute,
      path: '/dziennik',
      beforeLoad: () => {
        throw redirect({ to: '/transakcje', replace: true });
      },
    }),
    createRoute({
      getParentRoute: () => appRoute,
      path: '/transakcje',
      component: TradesPage,
      // `?import=mt5` opens the MT5 import right away (from the empty statistics and dashboard).
      validateSearch: (search: Record<string, unknown>): { import?: 'mt5' } => (search.import === 'mt5' ? { import: 'mt5' } : {}),
    }),
    createRoute({ getParentRoute: () => appRoute, path: '/statystyki', component: StatsPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/kalkulator', component: CalculatorPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/analiza', component: AnalysisPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/analiza/backtesting', component: BacktestPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/strategie', component: StrategiesPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/kalendarz', component: CalendarPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/news', component: NewsPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/ustawienia', component: SettingsPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/admin', component: AdminPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/admin/$section', component: AdminPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/ustawienia/$section', component: SettingsPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/sygnaly', component: () => <ComingSoon module="signals" /> }),
  ]),
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // A missing session (401) is not retried: the app sends the user to the sign-in page.
      retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
