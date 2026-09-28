import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client.ts';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './features/auth/AuthPages.tsx';
import { CalculatorPage } from './features/calculator/CalculatorPage.tsx';
import { CalendarPage } from './features/calendar/CalendarPage.tsx';
import { JournalPage } from './features/journal/JournalPage.tsx';
import { StatsPage } from './features/stats/StatsPage.tsx';
import { I18nProvider } from './i18n/index.tsx';
import { AppShell, ComingSoon } from './layout/AppShell.tsx';
import './styles.css';

const rootRoute = createRootRoute();

/** The signed-in app: everything inside the shell (header, navigation), which checks the session. */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppShell });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/logowanie', component: LoginPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/rejestracja', component: RegisterPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/reset-hasla', component: ForgotPasswordPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/nowe-haslo', component: ResetPasswordPage }),
  appRoute.addChildren([
    createRoute({ getParentRoute: () => appRoute, path: '/', component: JournalPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/statystyki', component: StatsPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/kalkulator', component: CalculatorPage }),
    createRoute({ getParentRoute: () => appRoute, path: '/analiza', component: () => <ComingSoon module="analysis" /> }),
    createRoute({ getParentRoute: () => appRoute, path: '/kalendarz', component: CalendarPage }),
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
