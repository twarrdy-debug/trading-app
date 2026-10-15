import type { Language } from '@trading/shared';

/**
 * The welcome e-mail's copy, following the landing page (web `i18n` → `landing`): the slogan, the
 * facts, the spotlights with their points, the smaller features and the closing line. Kept here as
 * a structure because it has lists; short sentences, like the rest of the app.
 */
interface Spotlight {
  kicker: string;
  title: string;
  text: string;
  points: string[];
  link: string;
  path: string;
  note?: string;
}

interface WelcomeCopy {
  subject: string;
  eyebrow: string;
  title: (name: string) => string;
  lead: string;
  button: string;
  facts: { value: string; label: string }[];
  sample: string;
  preview: { netPnl: string; winRate: string; profitFactor: string; equity: string; verdict: string; left: string };
  stepsTitle: string;
  steps: { title: string; text: string; link: string; path: string }[];
  featuresTitle: string;
  spotlights: Spotlight[];
  moreTitle: string;
  more: { title: string; text: string }[];
  mailsTitle: string;
  mails: { title: string; text: string }[];
  mailsLink: string;
  finalTitle: string;
  finalText: string;
  footer: string;
}

export const WELCOME: Record<Language, WelcomeCopy> = {
  pl: {
    subject: 'Witaj w AlphaLogFX',
    eyebrow: 'Dla day traderów CFD i futures',
    title: (name) => `Cześć ${name}, wznieś swój trading na wyższy poziom`,
    lead: 'Twoje konto jest aktywne. Dziennik z analizą, monitor dyscypliny, kalkulator CFD → futures i analiza rynku w jednej aplikacji. Ty skupiasz się na rynku, a aplikacja liczy wyniki i pilnuje Twoich limitów.',
    button: 'Otwórz aplikację',
    facts: [
      { value: 'CFD i futures', label: 'forex, złoto, indeksy' },
      { value: 'Pips · punkt · tick', label: 'liczone automatycznie' },
      { value: 'MT5 i Tradovate', label: 'cała historia z jednego pliku' },
    ],
    sample: 'Przykładowe dane',
    preview: { netPnl: 'Wynik netto', winRate: 'Win rate', profitFactor: 'Profit factor', equity: 'Skumulowany wynik', verdict: 'Możesz handlować', left: 'Zostały 2 z 3 transakcji' },
    stepsTitle: 'Na start: 3 kroki, około 5 minut',
    steps: [
      { title: 'Dodaj konto tradingowe', text: 'Live albo prop: wielkość, dźwignia, limit drawdownu, cel zysku i dzienne limity. Saldo liczy się samo.', link: 'Dodaj konto', path: '/ustawienia/konta' },
      { title: 'Wczytaj historię', text: 'Raport z MetaTrader 5 (HTML lub .xlsx) albo Position History z Tradovate (CSV). Duplikaty pominiemy, a każdą transakcję możesz też wpisać ręcznie.', link: 'Importuj historię', path: '/transakcje?import=mt5' },
      { title: 'Ustaw limity dyscypliny', text: 'Maksimum transakcji dziennie i próg strat: z rzędu albo wszystkich w ciągu dnia. Każde konto może mieć własne.', link: 'Ustaw limity', path: '/ustawienia/dyscyplina' },
    ],
    featuresTitle: 'Co dostajesz',
    spotlights: [
      {
        kicker: 'Trading journal',
        title: 'Zaawansowany dziennik z analizą',
        text: 'Wpisz wejście, stop loss i wielkość pozycji. Pipsy, punkty lub ticki, R, ryzyko jako procent salda i wynik w walucie konta policzą się same, także gdy zamykasz pozycję w częściach.',
        points: [
          'Statystyki według instrumentu, emocji i kolejnej transakcji dnia',
          'Krzywa salda z granicą drawdownu i celem konta prop',
          'Kalendarz wyników, serie i ocena dyscypliny każdego dnia',
          'Zrzuty ekranu, emocje i notatki przy każdej transakcji',
        ],
        link: 'Otwórz dziennik',
        path: '/dziennik',
      },
      {
        kicker: 'Monitor tradingu',
        title: 'Dyscyplina, której nie musisz pilnować sam',
        text: 'Monitor pokazuje, ile transakcji Ci zostało, a po serii strat mówi wprost: zakończ sesję.',
        points: [
          'Taśma dnia: każda transakcja w swoim slocie, z wynikiem w R',
          'Ostrzeżenie po stratach z rzędu albo po wszystkich stratach dnia',
          'Czerwony baner na każdym ekranie aplikacji',
          'Codzienna ocena: limit, stop loss, emocje i serie strat',
        ],
        link: 'Zobacz monitor',
        path: '/dashboard',
      },
      {
        kicker: 'Kalkulator CFD → futures',
        title: 'Sygnał z CFD od razu na futures',
        text: 'Dostajesz poziomy na US100 albo XAUUSD, a grasz NQ lub GC? Kalkulator przeliczy wejście, stop loss i take profity na kontrakt futures według aktualnej różnicy cen.',
        points: [
          'US100 → NQ/MNQ, US500 → ES/MES, US30 → YM/MYM, XAUUSD → GC/MGC',
          'Różnica mierzona co 15 minut, z alertem, gdy się zmieni',
          'Ceny zaokrąglone do ticka, ryzyko i zysk w dolarach na kontrakt',
        ],
        link: 'Otwórz kalkulator',
        path: '/kalkulator',
      },
      {
        kicker: 'Analiza rynku',
        title: 'Poziomy, które widzi rynek, zanim otworzysz pozycję',
        text: 'FVG, order blocki, BOS i CHoCH, równe szczyty i dołki oraz poziomy dnia i tygodnia, wyliczone automatycznie od M5 do D1, z odległością od ceny w ATR.',
        points: [
          'Wykres w kolorach TradingView z EMA, RSI i MACD',
          'Pięć najbliższych poziomów nad i pod ceną',
          'Słowniczek: każda strefa wyjaśniona w dwóch zdaniach',
        ],
        link: 'Otwórz analizę',
        path: '/analiza',
        note: 'To nie jest porada inwestycyjna.',
      },
    ],
    moreTitle: 'A do tego wszystko, czego potrzebujesz w trakcie sesji',
    more: [
      { title: 'Kalendarz ekonomiczny', text: 'Dzień, tydzień i miesiąc, odliczanie do ważnych danych i filtr po walucie.' },
      { title: 'Newsy na żywo', text: 'Nagłówki w czasie rzeczywistym i alerty na Twoje słowa kluczowe.' },
      { title: 'Konta prop i live', text: 'Drawdown statyczny lub EOD i cel zysku. Widzisz, ile zostało do granicy.' },
      { title: 'Strategie i checklisty', text: 'Warunki wejścia do odhaczenia przed każdą transakcją.' },
    ],
    mailsTitle: 'Maile, które będziesz dostawać',
    mails: [
      { title: 'Nadchodzący tydzień', text: 'W niedzielę o 18:00: ważne wydarzenia dla walut Twoich ulubionych instrumentów.' },
      { title: 'Podsumowanie dnia', text: 'O 22:00 w dni z zamkniętą transakcją: wynik, dyscyplina i jutrzejszy kalendarz.' },
      { title: 'Co nowego', text: 'Po aktualizacjach aplikacji.' },
    ],
    mailsLink: 'Każdy z nich wyłączysz w ustawieniach',
    finalTitle: 'Graj według planu, nie według emocji',
    finalText: 'Pierwsza transakcja w dzienniku to pierwszy krok.',
    footer: 'Dostajesz tę wiadomość, bo założyłeś konto w AlphaLogFX.',
  },
  en: {
    subject: 'Welcome to AlphaLogFX',
    eyebrow: 'For CFD and futures day traders',
    title: (name) => `Hi ${name}, take your trading to the next level`,
    lead: 'Your account is active. A journal with analytics, a discipline monitor, a CFD → futures calculator and market analysis in one app. You focus on the market; the app does the maths and keeps you within your limits.',
    button: 'Open the app',
    facts: [
      { value: 'CFD and futures', label: 'forex, gold, indices' },
      { value: 'Pip · point · tick', label: 'worked out for you' },
      { value: 'MT5 and Tradovate', label: 'your whole history from one file' },
    ],
    sample: 'Sample data',
    preview: { netPnl: 'Net P&L', winRate: 'Win rate', profitFactor: 'Profit factor', equity: 'Cumulative P&L', verdict: 'You can trade', left: '2 of 3 trades left' },
    stepsTitle: 'Getting started: 3 steps, about 5 minutes',
    steps: [
      { title: 'Add a trading account', text: 'Live or prop: size, leverage, drawdown limit, profit target and daily limits. The balance updates itself.', link: 'Add an account', path: '/ustawienia/konta' },
      { title: 'Load your history', text: 'A MetaTrader 5 report (HTML or .xlsx) or Tradovate Position History (CSV). Duplicates are skipped, and you can always enter a trade by hand.', link: 'Import history', path: '/transakcje?import=mt5' },
      { title: 'Set your discipline limits', text: 'Maximum trades a day and a losses threshold: in a row or all of the day. Each account can have its own.', link: 'Set limits', path: '/ustawienia/dyscyplina' },
    ],
    featuresTitle: 'What you get',
    spotlights: [
      {
        kicker: 'Trading journal',
        title: 'An advanced journal with analytics',
        text: 'Enter the entry, stop loss and size. Pips, points or ticks, R, risk as a share of the balance and the result in your account currency are worked out, even when you close in parts.',
        points: [
          'Statistics by instrument, emotion and trade number of the day',
          'Balance curve with the drawdown floor and the prop profit target',
          'Results calendar, streaks and a discipline score for every day',
          'Screenshots, emotions and notes on every trade',
        ],
        link: 'Open the journal',
        path: '/dziennik',
      },
      {
        kicker: 'Trading monitor',
        title: 'Discipline you do not have to police yourself',
        text: 'The monitor shows how many trades you have left, and after a losing streak it says it plainly: end the session.',
        points: [
          'Day tape: every trade in its slot, with its result in R',
          'A warning after losses in a row, or after every loss of the day',
          'A red banner on every screen of the app',
          'A daily score: limit, stop loss, emotions and losing streaks',
        ],
        link: 'See the monitor',
        path: '/dashboard',
      },
      {
        kicker: 'CFD → futures calculator',
        title: 'A CFD signal straight onto futures',
        text: 'Getting levels for US100 or XAUUSD but trading NQ or GC? The calculator converts the entry, stop loss and take profits to the futures contract at the current price difference.',
        points: [
          'US100 → NQ/MNQ, US500 → ES/MES, US30 → YM/MYM, XAUUSD → GC/MGC',
          'The difference measured every 15 minutes, with an alert when it moves',
          'Prices rounded to the tick, risk and reward in dollars per contract',
        ],
        link: 'Open the calculator',
        path: '/kalkulator',
      },
      {
        kicker: 'Market analysis',
        title: 'The levels the market sees, before you open a position',
        text: 'FVGs, order blocks, BOS and CHoCH, equal highs and lows and day and week levels, found automatically from M5 to D1, with the distance from the price in ATR.',
        points: [
          'A chart in TradingView colours with EMA, RSI and MACD',
          'The five nearest levels above and below the price',
          'A glossary: every zone explained in two sentences',
        ],
        link: 'Open the analysis',
        path: '/analiza',
        note: 'This is not investment advice.',
      },
    ],
    moreTitle: 'Plus everything you need during the session',
    more: [
      { title: 'Economic calendar', text: 'Day, week and month, a countdown to the big releases and a currency filter.' },
      { title: 'Live news', text: 'Real-time headlines and alerts on your keywords.' },
      { title: 'Prop and live accounts', text: 'Static or EOD drawdown and a profit target. See how far you are from the floor.' },
      { title: 'Strategies and checklists', text: 'Entry conditions to tick off before every trade.' },
    ],
    mailsTitle: 'E-mails you will get',
    mails: [
      { title: 'The week ahead', text: "On Sunday at 18:00: the important events for your favourite instruments' currencies." },
      { title: 'Day summary', text: "At 22:00 on days you closed a trade: result, discipline and tomorrow's calendar." },
      { title: "What's new", text: 'After app updates.' },
    ],
    mailsLink: 'You can turn each of them off in the settings',
    finalTitle: 'Trade the plan, not your emotions',
    finalText: 'Your first trade in the journal is the first step.',
    footer: 'You are receiving this because you created an AlphaLogFX account.',
  },
};
