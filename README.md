# BharatChart

A focused Linux desktop chart terminal for Indian equities. The chart surface is powered by TradingView **Lightweight Charts™ 5.2.1**.

## First version

- NSE and BSE symbol directory, refreshed from TejHQ's exchange-derived end-of-day snapshots, with an official NSE security-list fallback.
- Daily, weekly and monthly OHLCV history from TejHQ.
- Intraday intervals (1m, 5m, 15m, 30m, 1h) from Yahoo Finance where a matching Yahoo ticker is available.
- Candlestick, OHLC bar, line and area chart styles.
- Mouse-wheel zoom, drag-to-pan, crosshair, price/time scales, fit-to-data and user-placed horizontal price lines.
- Symbol search by ticker or company name.

This is deliberately chart-first. It does not include order placement, broker connections, indicators, screeners, news or portfolio features.

## Data coverage and important limitations

**Daily history:** the free keyless TejHQ API is used for end-of-day OHLCV. Its published coverage is NSE from 4 January 2010 and BSE from 8 July 2024, updated after the exchange session (usually the next morning IST). The symbol directory is refreshed from the latest available NSE/BSE snapshot. Newly listed, suspended, renamed or illiquid instruments may be absent or have incomplete history.

**Intraday history:** Yahoo Finance's chart endpoint is used for 1m, 5m, 15m, 30m and 1h bars. Intraday history has provider-imposed lookback limits and not every exchange symbol has a Yahoo mapping. The app reports an error when a symbol/interval is unavailable. Yahoo's data delay and coverage can vary; check the displayed bar time before relying on a chart.

**Private-use data terms:** TejHQ describes its no-key data tier as free for personal use (including local dashboards and private trading research), and says product/client/business use requires a paid plan. Yahoo Finance's help terms say its information is for informational purposes and must not be redistributed. This application fetches data directly on the user's machine and is intended for private personal use only. Do not publish, re-host or distribute provider data. Any exchange-specific display or redistribution rights remain subject to NSE/BSE terms.

Sources:
- TejHQ coverage: https://tejhq.dev/
- TejHQ data terms: https://tejhq.dev/data-terms
- TejHQ API docs: https://tejhq.dev/docs
- Yahoo exchange delays and data terms: https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html
- NSE securities list: https://www.nseindia.com/static/market-data/securities-available-for-trading

## Build from source

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev:app
```

Create a Linux x86_64 AppImage:

```bash
npm run dist:linux
```

The AppImage is written to `release/`.

## Attribution and licensing

TradingView Lightweight Charts™ is open-source under Apache License 2.0. Its required creator notice and a link to https://www.tradingview.com/ are shown in the app. See `THIRD_PARTY_NOTICES.md`.

BharatChart source code is MIT-licensed. Provider market data is not included in this repository and is fetched at runtime under the providers' respective terms.
