# India Stock Screener

A deliberately small Linux desktop screener for NSE and BSE equities. It contains only a searchable, sortable table of price returns and valuation metrics.

## Columns
- Price performance: All time, 1Y, YTD, 6M, 3M, 1M, 1W and 1D.
- Valuation: Market capitalization (INR crore), P/E and P/B.
- Identification: Company name, ticker and exchange.

Click any numeric column header to sort ascending or descending. Search matches company name or ticker. Results are paged locally; sorting and searching do not call a data provider.

## Data sources
- Price performance: the public tejhq/indian-markets Parquet dataset on Hugging Face. Returns are calculated on back-adjusted daily closes. The app reads the latest NSE/BSE metrics files and adjusted historical price columns to find each symbol's earliest price.
- Market cap / valuation: BharatStock API GET /v1/screener, using market_cap, pe_ratio and pb_ratio. Market capitalization is reported in INR crores.

The price feed is end-of-day, not live. TejHQ reports NSE data from 04 Jan 2010 and BSE data from 08 Jul 2024. All time means the return from the earliest adjusted price present in that dataset for the symbol; it cannot represent trading history before those coverage dates, and renamed/reused symbols may have shorter or ambiguous histories. Splits, bonus issues and dividends are reflected in the adjusted-price series.

## First run
1. Create a free API key at https://bharatstockapi.com/.
2. Enter it in the app. It is saved in the local Electron user-data directory; the app encrypts it with the operating-system secure-storage service when available and otherwise restricts the key file to the current user (0600).
3. The app retrieves the paginated stock universe and valuation data, then caches the merged table locally. The free BharatStock plan allows 60 requests per UTC day. The app requests up to 200 rows per page and automatically refreshes no more than once every 26 hours; a manual refresh uses API requests too.
4. On first use, the app scans selected columns of historical adjusted-price Parquet files to create the all-time cache. Subsequent sorting, searching and page changes are local.

No API key is required for the TejHQ Hugging Face Parquet price dataset. BharatStock requires its own free key for the stock universe and valuation columns.

## Data terms
This app is intended for private/personal use. BharatStock's terms permit in-app consumption/display but prohibit reselling, re-serving or bulk redistribution of raw data. Exchange-published price data remains subject to NSE/BSE rights and terms. Do not redistribute the app's cached market data or expose your API key.

## Build (Linux x86_64)
Requires Node.js 22+ and npm.

~~~bash
npm install
npm test
npm run dev:app
~~~

Build the AppImage:

~~~bash
npm run dist:linux
~~~

The output is written to release/.
