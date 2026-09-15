/**
 * Papan Saham — API Proxy & Adapter
 * ------------------------------------------------------------
 * Server ini mengambil data dari Yahoo Finance (publik, gratis,
 * tanpa API key) untuk saham IDX (kode ditambah akhiran .JK),
 * lalu menghitung sendiri indikator teknikal (MA, RSI, MACD,
 * support/resistance) dari data harga historisnya, dan
 * menyusun semuanya sesuai skema yang dipakai app Papan Saham.
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------
 * Ambil data mentah dari Yahoo Finance
 * ------------------------------------------------------------ */
async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Gagal ambil data harga (status ${res.status})`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('Kode saham tidak ditemukan di Yahoo Finance.');
  return result;
}

async function fetchFundamentals(symbol) {
  const modules = 'defaultKeyStatistics,financialData,summaryDetail,price';
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Gagal ambil data fundamental (status ${res.status})`);
  const json = await res.json();
  return json?.quoteSummary?.result?.[0] || {};
}

/* ------------------------------------------------------------
 * Perhitungan indikator teknikal dari data harga historis
 * ------------------------------------------------------------ */
function sma(values, period) {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return undefined;
  const k = 2 / (period + 1);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(emaVal);
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
    out.push(emaVal);
  }
  return out;
}

function rsi14(closes) {
  const period = 14;
  if (closes.length < period + 1) return undefined;
  const recent = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function macdCalc(closes) {
  if (closes.length < 35) return { macd: undefined, signal: undefined };
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const len = Math.min(ema12.length, ema26.length);
  const macdLine = [];
  for (let i = 0; i < len; i++) {
    macdLine.push(ema12[ema12.length - len + i] - ema26[ema26.length - len + i]);
  }
  const signalSeries = emaSeries(macdLine, 9);
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalSeries[signalSeries.length - 1],
  };
}

function round2(n) {
  return n === undefined || n === null || isNaN(n) ? undefined : Math.round(n * 100) / 100;
}

function computeTechnical(chartResult) {
  const closes = (chartResult.indicators?.quote?.[0]?.close || []).filter(v => v !== null);
  const highs = (chartResult.indicators?.quote?.[0]?.high || []).filter(v => v !== null);
  const lows = (chartResult.indicators?.quote?.[0]?.low || []).filter(v => v !== null);
  const volumes = (chartResult.indicators?.quote?.[0]?.volume || []).filter(v => v !== null);

  const price = chartResult.meta?.regularMarketPrice;
  const prevClose = chartResult.meta?.previousClose ?? chartResult.meta?.chartPreviousClose;

  const { macd, signal } = macdCalc(closes);
  const last20High = highs.slice(-20);
  const last20Low = lows.slice(-20);
  const avgVol20 = sma(volumes, 20);

  return {
    price: round2(price),
    prevClose: round2(prevClose),
    ma20: round2(sma(closes, 20)),
    ma50: round2(sma(closes, 50)),
    ma200: round2(sma(closes, 200)),
    rsi: round2(rsi14(closes)),
    macd: round2(macd),
    macdSignal: round2(signal),
    volume: volumes[volumes.length - 1],
    avgVolume: avgVol20 ? Math.round(avgVol20) : undefined,
    support: last20Low.length ? round2(Math.min(...last20Low)) : undefined,
    resistance: last20High.length ? round2(Math.max(...last20High)) : undefined,
  };
}

function computeFundamental(fundResult) {
  const dks = fundResult.defaultKeyStatistics || {};
  const fd = fundResult.financialData || {};
  const sd = fundResult.summaryDetail || {};

  return {
    per: round2(sd.trailingPE?.raw ?? dks.trailingPE?.raw),
    pbv: round2(dks.priceToBook?.raw),
    roe: round2((fd.returnOnEquity?.raw) ? fd.returnOnEquity.raw * 100 : undefined),
    der: round2(fd.debtToEquity?.raw !== undefined ? fd.debtToEquity.raw / 100 : undefined),
    npm: round2((fd.profitMargins?.raw) ? fd.profitMargins.raw * 100 : undefined),
    revenueGrowth: round2((fd.revenueGrowth?.raw) ? fd.revenueGrowth.raw * 100 : undefined),
    dividendYield: round2((sd.dividendYield?.raw) ? sd.dividendYield.raw * 100 : undefined),
  };
}

/* ------------------------------------------------------------
 * Gabungkan semua ke skema Papan Saham
 * ------------------------------------------------------------ */
function toYahooSymbol(ticker) {
  const t = ticker.trim().toUpperCase();
  return t.endsWith('.JK') ? t : `${t}.JK`;
}

async function getStockData(ticker) {
  const symbol = toYahooSymbol(ticker);
  const [chartResult, fundResult] = await Promise.all([
    fetchChart(symbol),
    fetchFundamentals(symbol).catch(() => ({})), // fundamental boleh gagal, teknikal tetap jalan
  ]);

  const technical = computeTechnical(chartResult);
  const fundamental = computeFundamental(fundResult);

  return {
    ticker: ticker.trim().toUpperCase(),
    name: chartResult.meta?.longName || chartResult.meta?.shortName || fundResult.price?.longName || '',
    ...technical,
    ...fundamental,
  };
}

/* ------------------------------------------------------------
 * Endpoint yang dipanggil dari app Papan Saham
 * ------------------------------------------------------------ */

app.get('/saham/:ticker', async (req, res) => {
  try {
    const data = await getStockData(req.params.ticker);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Gagal mengambil data.', detail: err.message });
  }
});

app.get('/saham', async (req, res) => {
  const tickersParam = req.query.tickers;
  if (!tickersParam) {
    return res.status(400).json({ error: 'Sertakan ?tickers=BBCA,BBRI,...' });
  }
  const tickers = tickersParam.split(',').map(t => t.trim()).filter(Boolean);

  const results = [];
  for (const ticker of tickers) {
    try {
      results.push(await getStockData(ticker));
    } catch (err) {
      results.push({ ticker: ticker.toUpperCase(), error: err.message });
    }
  }
  res.json(results);
});

app.get('/', (req, res) => {
  res.send('Papan Saham API aktif (sumber data: Yahoo Finance). Gunakan /saham/KODE atau /saham?tickers=A,B,C');
});

app.listen(PORT, () => {
  console.log(`Papan Saham API jalan di http://localhost:${PORT}`);
});
