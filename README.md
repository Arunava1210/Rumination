# India Stock Screener

A focused Linux desktop screener for Indian equities. It contains only the requested market-performance and valuation columns, with sortable headers.

## Columns

- All-time price change
- 1-year price change
- Year-to-date price change
- 6-month price change
- 3-month price change
- 1-month price change
- 1-week price change
- 1-day price change
- Market capitalization
- P/E ratio

Click a column heading to sort ascending or descending. The search field matches stock symbols and company names. No charting, indicators, or unrelated features are included.

## Data

- **Returns and adjusted closing prices:** TejHQ's daily NSE/BSE metrics Parquet files, built from exchange bhavcopies and adjusted for corporate actions. These are end-of-day values, not live quotes. NSE coverage begins 4 January 2010; BSE coverage begins 8 July 2024.
- **Market capitalization:** NSE's bulk Stocks Traded feed. The value is the exchange's reported market capitalisation, shown in ₹ crore.
- **P/E:** NSE's daily PE Ratio report.
- **Company names:** TejHQ's exchange snapshots. Symbols remain visible when a company-name lookup is unavailable.

The all-time column means change from the earliest adjusted-price observation available in this data source for that instrument. It is not guaranteed to equal the IPO-to-date return when a listing predates the dataset or the instrument's ISIN changed. BSE-only listings may not have NSE market-cap/P-E data, and those cells are left blank rather than estimated.

Data is cached locally after retrieval. Exchange and data-provider terms apply; the app is intended for personal research and does not redistribute market-data files.

## Run from source

Requires Node.js 22+ and npm.

    npm install
    npm test
    npm run dev:app

Build a Linux x86_64 AppImage:

    npm run dist:linux

The AppImage is written to `release/`.
