/**
 * Papan Saham — API Proxy & Adapter
 * ------------------------------------------------------------
 * Server kecil ini punya dua tugas:
 *  1. Menyembunyikan API key sumber datamu (tidak boleh ditaruh di HTML/browser).
 *  2. Mengubah ("memetakan") bentuk respons API sumber datamu menjadi skema
 *     yang dipakai aplikasi "Papan Saham" (lihat tab "Skema Data" di app-nya).
 *
 * Cara pakai singkat:
 *  1. Isi file .env (lihat .env.example) dengan URL & API key sumber datamu.
 *  2. Sesuaikan fungsi mapToSchema() di bawah agar cocok dengan bentuk
 *     respons API-mu yang sebenarnya (bagian ini WAJIB disesuaikan).
 *  3. Jalankan server ini (lokal atau di layanan hosting gratis — lihat README.md).
 *  4. Di app "Papan Saham", tempel URL server ini + endpoint /saham/KODE
 *     ke kolom "Ambil langsung dari URL API".
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors()); // izinkan dipanggil dari browser/app Papan Saham

const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.API_BASE_URL;       // contoh: https://api.sumberdatamu.com
const API_KEY = process.env.API_KEY;                 // key dari sumber data kamu
const API_KEY_HEADER = process.env.API_KEY_HEADER || 'Authorization'; // nama header auth

if (!API_BASE_URL) {
  console.warn('[peringatan] API_BASE_URL belum diisi di .env — server akan gagal saat request masuk.');
}

/**
 * ------------------------------------------------------------
 * ADAPTER — SESUAIKAN BAGIAN INI dengan bentuk respons API-mu.
 * ------------------------------------------------------------
 * `raw` adalah data mentah apa adanya dari API sumbermu.
 * Kembalikan objek sesuai skema Papan Saham. Field yang tidak
 * tersedia dari API-mu boleh dikosongkan (undefined) — aman.
 *
 * Contoh di bawah mengasumsikan API sumbermu mengembalikan
 * struktur umum seperti { symbol, companyName, lastPrice, ... }.
 * Ganti path field di sisi kanan (raw.xxx) sesuai punya kamu.
 */
function mapToSchema(raw) {
  return {
    ticker: raw.symbol || raw.ticker || raw.kode,
    name: raw.companyName || raw.name || raw.nama,

    price: numOrUndef(raw.lastPrice ?? raw.price ?? raw.close),
    prevClose: numOrUndef(raw.previousClose ?? raw.prevClose),

    ma20: numOrUndef(raw.ma20 ?? raw?.technical?.ma20),
    ma50: numOrUndef(raw.ma50 ?? raw?.technical?.ma50),
    ma200: numOrUndef(raw.ma200 ?? raw?.technical?.ma200),

    rsi: numOrUndef(raw.rsi14 ?? raw.rsi ?? raw?.technical?.rsi),
    macd: numOrUndef(raw.macd ?? raw?.technical?.macd?.value),
    macdSignal: numOrUndef(raw.macdSignal ?? raw?.technical?.macd?.signal),

    volume: numOrUndef(raw.volume),
    avgVolume: numOrUndef(raw.avgVolume ?? raw.averageVolume),

    support: numOrUndef(raw.support ?? raw?.technical?.support),
    resistance: numOrUndef(raw.resistance ?? raw?.technical?.resistance),

    per: numOrUndef(raw.per ?? raw?.fundamental?.per),
    pbv: numOrUndef(raw.pbv ?? raw?.fundamental?.pbv),
    roe: numOrUndef(raw.roe ?? raw?.fundamental?.roe),
    der: numOrUndef(raw.der ?? raw?.fundamental?.der),
    npm: numOrUndef(raw.npm ?? raw?.fundamental?.netProfitMargin),
    revenueGrowth: numOrUndef(raw.revenueGrowth ?? raw?.fundamental?.revenueGrowth),
    dividendYield: numOrUndef(raw.dividendYield ?? raw?.fundamental?.dividendYield),
  };
}

function numOrUndef(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

/**
 * Panggil API sumber data untuk satu kode saham.
 * SESUAIKAN path endpoint & cara autentikasinya dengan dokumentasi API-mu.
 */
async function fetchFromSource(ticker) {
  const url = `${API_BASE_URL}/quote/${ticker}`; // <-- sesuaikan path endpoint sumbermu

  const headers = {};
  if (API_KEY) {
    if (API_KEY_HEADER.toLowerCase() === 'authorization') {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    } else {
      headers[API_KEY_HEADER] = API_KEY;
    }
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Sumber data merespons status ${res.status}`);
  }
  return res.json();
}

/* ------------------------------------------------------------
 * Endpoint yang dipanggil dari app Papan Saham
 * ------------------------------------------------------------ */

// Satu saham: GET /saham/BBCA
app.get('/saham/:ticker', async (req, res) => {
  try {
    const raw = await fetchFromSource(req.params.ticker.toUpperCase());
    res.json(mapToSchema(raw));
  } catch (err) {
    res.status(502).json({ error: 'Gagal mengambil data dari sumber.', detail: err.message });
  }
});

// Banyak saham sekaligus: GET /saham?tickers=BBCA,BBRI,TLKM
app.get('/saham', async (req, res) => {
  const tickersParam = req.query.tickers;
  if (!tickersParam) {
    return res.status(400).json({ error: 'Sertakan ?tickers=BBCA,BBRI,...' });
  }
  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  const results = [];
  for (const ticker of tickers) {
    try {
      const raw = await fetchFromSource(ticker);
      results.push(mapToSchema(raw));
    } catch (err) {
      results.push({ ticker, error: err.message });
    }
  }
  res.json(results);
});

app.get('/', (req, res) => {
  res.send('Papan Saham API proxy aktif. Gunakan /saham/KODE atau /saham?tickers=A,B,C');
});

app.listen(PORT, () => {
  console.log(`Papan Saham API proxy jalan di http://localhost:${PORT}`);
});
