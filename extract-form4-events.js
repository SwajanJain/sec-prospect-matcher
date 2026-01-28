#!/usr/bin/env node
/**
 * Extract high-signal Form 4 insider transactions from SEC filing .txt bundles.
 * Designed for Alma News-style "liquidity trigger" events.
 *
 * This does NOT use a general XML parser (no extra deps). It uses targeted tag regexes
 * that work with the standard EDGAR Form 4 <ownershipDocument> schema.
 *
 * Example:
 *   node extract-form4-events.js --prospects "/Users/me/Downloads/Philips Academy.csv" --sec-dir "/Users/me/Downloads/SEC Filings" --out "/tmp/form4_events.csv" --max-files 2000
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = {
        prospects: null,
        secDir: null,
        out: './matches/form4_events.csv',
        maxFiles: null,
        recursive: false
    };

    const rest = argv.slice(2);
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        switch (arg) {
            case '--prospects':
            case '-p':
                args.prospects = rest[++i];
                break;
            case '--sec-dir':
            case '-s':
                args.secDir = rest[++i];
                break;
            case '--out':
            case '-o':
                args.out = rest[++i];
                break;
            case '--max-files':
                args.maxFiles = Number(rest[++i]);
                break;
            case '--recursive':
                args.recursive = true;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function usage() {
    console.log(`
Extract Form 4 events

Usage:
  node extract-form4-events.js --prospects <csv> --sec-dir <dir> [options]

Options:
  --out, -o       Output CSV path (default: ./matches/form4_events.csv)
  --max-files     Limit number of files processed
  --recursive     Recursively scan subdirectories under --sec-dir
`);
}

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function walkFiles(dir, recursive) {
    const out = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) out.push(...walkFiles(fullPath, recursive));
            continue;
        }
        if (entry.isFile()) out.push(fullPath);
    }
    return out;
}

function normalizeName(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitNameTokens(name) {
    const tokens = normalizeName(name).split(' ').filter(Boolean);
    if (tokens.length < 2) return null;
    return { first: tokens[0], last: tokens[tokens.length - 1] };
}

async function buildProspectIndex(csvPath) {
    const csvParser = require('csv-parser');

    return new Promise((resolve, reject) => {
        const map = new Map(); // normalized full-name => prospect

        fs.createReadStream(csvPath)
            .pipe(csvParser())
            .on('data', (row) => {
                const id = (row.prospect_id || row['Prospect ID'] || row.prospectId || row.id || row.ID || '').toString().trim();
                const name = (row.prospect_name || row['Prospect Name'] || row.name || row.Name || '').toString().trim();
                const company = (row.company_name || row['Company Name'] || row.company || row.Company || '').toString().trim();
                if (!id || !name) return;

                const tokens = splitNameTokens(name);
                if (!tokens) return;

                const key1 = `${tokens.first} ${tokens.last}`;
                const key2 = `${tokens.last} ${tokens.first}`; // Form 4 often uses "Last First"

                const prospect = { prospect_id: id, prospect_name: name, company_name: company };
                map.set(key1, prospect);
                map.set(key2, prospect);
            })
            .on('end', () => resolve(map))
            .on('error', reject);
    });
}

function readHead(filePath, maxBytes = 4096) {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return buffer.toString('utf8', 0, bytesRead);
}

function getSubmissionType(filePath) {
    const head = readHead(filePath, 4096);
    const marker = 'CONFORMED SUBMISSION TYPE:';
    const idx = head.indexOf(marker);
    if (idx === -1) return null;
    const rest = head.slice(idx + marker.length);
    return (rest.split(/\r?\n/)[0] || '').trim() || null;
}

function firstMatch(text, regex) {
    const m = text.match(regex);
    return m ? (m[1] || '').trim() : null;
}

function numberOrNull(value) {
    if (value == null) return null;
    const cleaned = String(value).replace(/,/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function extractForm4(docText) {
    const ownerName = firstMatch(docText, /<rptOwnerName>([^<]+)<\/rptOwnerName>/i);
    if (!ownerName) return null;

    const ownerCik = firstMatch(docText, /<rptOwnerCik>([^<]+)<\/rptOwnerCik>/i);
    const ownerCity = firstMatch(docText, /<rptOwnerCity>([^<]+)<\/rptOwnerCity>/i);
    const ownerState = firstMatch(docText, /<rptOwnerState>([^<]+)<\/rptOwnerState>/i);

    const issuerName = firstMatch(docText, /<issuerName>([^<]+)<\/issuerName>/i);
    const ticker = firstMatch(docText, /<issuerTradingSymbol>([^<]+)<\/issuerTradingSymbol>/i);
    const periodOfReport = firstMatch(docText, /<periodOfReport>([^<]+)<\/periodOfReport>/i);
    const is10b51 = firstMatch(docText, /<aff10b5One>([^<]+)<\/aff10b5One>/i);

    const transactions = [];
    const txRegex = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi;
    for (const m of docText.matchAll(txRegex)) {
        const block = m[1];
        const code = firstMatch(block, /<transactionCode>([^<]+)<\/transactionCode>/i);
        const date = firstMatch(block, /<transactionDate>\s*<value>([^<]+)<\/value>/i);
        const shares = firstMatch(block, /<transactionShares>\s*<value>([^<]+)<\/value>/i);
        const price = firstMatch(block, /<transactionPricePerShare>\s*<value>([^<]+)<\/value>/i);
        const securityTitle = firstMatch(block, /<securityTitle>\s*<value>([^<]+)<\/value>/i);

        const sharesNum = numberOrNull(shares);
        const priceNum = numberOrNull(price);
        const proceeds = sharesNum != null && priceNum != null ? sharesNum * priceNum : null;

        transactions.push({
            code,
            date,
            shares: sharesNum,
            price: priceNum,
            proceeds,
            securityTitle
        });
    }

    return {
        ownerName,
        ownerCik,
        ownerCity,
        ownerState,
        issuerName,
        ticker,
        periodOfReport,
        is10b51: is10b51 === '1' ? true : (is10b51 === '0' ? false : null),
        transactions
    };
}

function writeCsv(rows, outPath) {
    const headers = [
        'prospect_id',
        'prospect_name',
        'prospect_company',
        'sec_filing',
        'owner_cik',
        'owner_city',
        'owner_state',
        'issuer_name',
        'ticker',
        'period_of_report',
        'transaction_code',
        'transaction_date',
        'security_title',
        'shares',
        'price',
        'gross_proceeds',
        'is_10b5_1',
        'alma_event_label'
    ];

    const escape = (v) => {
        if (v == null) return '';
        const s = String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => escape(row[h])).join(','));
    }

    ensureParentDir(outPath);
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        usage();
        process.exit(0);
    }
    if (!args.prospects || !args.secDir) {
        usage();
        throw new Error('Missing required args: --prospects and --sec-dir');
    }

    const prospectIndex = await buildProspectIndex(args.prospects);
    console.log(`✅ Loaded prospect name index: ${prospectIndex.size} keys`);

    const all = walkFiles(args.secDir, args.recursive)
        .filter(p => p.toLowerCase().endsWith('.txt'))
        .sort();
    const selected = Number.isFinite(args.maxFiles) && args.maxFiles > 0 ? all.slice(0, args.maxFiles) : all;

    const rows = [];
    let processed = 0;

    for (const filePath of selected) {
        const submissionType = getSubmissionType(filePath);
        if (submissionType !== '4' && submissionType !== '4/A') continue;

        const text = fs.readFileSync(filePath, 'utf8');
        const data = extractForm4(text);
        if (!data) continue;

        const ownerKey = normalizeName(data.ownerName);
        const prospect = prospectIndex.get(ownerKey);
        if (!prospect) continue;

        for (const tx of data.transactions) {
            rows.push({
                prospect_id: prospect.prospect_id,
                prospect_name: prospect.prospect_name,
                prospect_company: prospect.company_name,
                sec_filing: path.basename(filePath),
                owner_cik: data.ownerCik,
                owner_city: data.ownerCity,
                owner_state: data.ownerState,
                issuer_name: data.issuerName,
                ticker: data.ticker,
                period_of_report: data.periodOfReport,
                transaction_code: tx.code,
                transaction_date: tx.date,
                security_title: tx.securityTitle,
                shares: tx.shares,
                price: tx.price,
                gross_proceeds: tx.proceeds != null ? Math.round(tx.proceeds * 100) / 100 : null,
                is_10b5_1: data.is10b51,
                alma_event_label: 'wealth_event'
            });
        }

        processed++;
        if (processed % 100 === 0) {
            console.log(`...matched ${processed} Form 4 filings so far (${rows.length} transactions)`); // coarse progress
        }
    }

    writeCsv(rows, args.out);
    console.log(`💾 Wrote ${rows.length} transactions to ${args.out}`);
}

main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
