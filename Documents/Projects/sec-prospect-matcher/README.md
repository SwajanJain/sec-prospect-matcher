# SEC Prospect Matcher

A web application to match prospect data with SEC filings automatically.

## Features

- 📊 Upload prospects CSV file
- 📄 Upload multiple SEC filing .txt files
- 🎯 Automatic matching based on prospect name + company name
- 🔗 Generate clickable SEC EDGAR URLs in output
- 📥 Download results as CSV

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser to: `http://localhost:3000`

## Input Format

### Prospects CSV
Required columns: `prospect_id`, `prospect_name`, `company_name`

Example:
```csv
prospect_id,prospect_name,company_name
1,John Doe,Apple Inc
2,Jane Smith,Microsoft Corp
```

### SEC Filing Files
- Format: `.txt` files
- Naming: `0000000000-23-010578.txt` (standard SEC format)
- Content: Any SEC filing text content

## Output

CSV file with matches containing:
- Prospect ID, Name, Company
- SEC Filing filename
- Clickable SEC EDGAR URL
- Match date

## How It Works

1. Parses prospect CSV data
2. Searches each SEC filing for both prospect name AND company name
3. Only creates matches when both are found in the same filing
4. Generates SEC EDGAR URLs for easy browser access
5. Exports results to downloadable CSV