import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CalculatorPage } from './features/calculator/CalculatorPage.tsx';
import { JournalPage } from './features/journal/JournalPage.tsx';
import { StatsPage } from './features/stats/StatsPage.tsx';
import { AppShell, ComingSoon } from './layout/AppShell.tsx';
import './styles.css';

const rootRoute = createRootRoute({ component: AppShell });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: JournalPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/statystyki', component: StatsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/kalkulator', component: CalculatorPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/analiza',
    component: () => <ComingSoon title="Analiza dzienna" stage="Etap 4" />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/kalendarz',
    component: () => <ComingSoon title="Kalendarz ekonomiczny" stage="Etap 5" />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/sygnaly',
    component: () => <ComingSoon title="Sygnały edukatorów" stage="Kolejny etap" />,
  }),
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
