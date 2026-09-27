const axios = require("axios");
const FormData = require("form-data");
const { load } = require("cheerio");

const BASE = "https://top4top.io/index.php";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Upload buffer file ke Top4Top, kembalikan direct link.
 * @param {Buffer} buffer - isi file (mp3, dsb)
 * @param {string} filename - nama file dengan ekstensi
 * @returns {Promise<string>} direct link top4top.io
 */
async function uploadTop4Top(buffer, filename = "file.mp3") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new TypeError("Invalid buffer. Provide a non-empty Buffer.");
  }
  if (buffer.length > 209715200) {
    throw new RangeError("File exceeds the 200 MB limit.");
  }

  // Step 1: GET homepage — ambil sid dan session cookie.
  // Catatan: top4top.io menyisipkan sid di query string SEMUA link di halaman
  // (?sid=xxxx), bukan hanya di input form. Jadi kalau input[name="sid"] tidak
  // ada, kita fallback ambil dari salah satu href yang mengandung "?sid=".
  const initRes = await axios.get(BASE, {
    headers: { "User-Agent": UA, Accept: "text/html", Referer: "https://top4top.io/" },
  });

  const $ = load(initRes.data);
  let sid = $('input[name="sid"]').attr("value") || "";

  if (!sid) {
    const hrefWithSid = $('a[href*="sid="]').first().attr("href") || "";
    const match = hrefWithSid.match(/[?&]sid=([^&"'\s]+)/);
    if (match) sid = match[1];
  }

  const rawCookies = initRes.headers["set-cookie"] || [];
  const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");

  // Step 2: POST upload dengan sid + cookie
  const form = new FormData();
  form.append("sid", sid);
  form.append("file_0_", buffer, { filename });
  form.append("submitr", "[ رفع الملفات ]");

  const { data } = await axios.post(BASE, form, {
    headers: {
      ...form.getHeaders(),
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://top4top.io",
      Referer: `${BASE}?sid=${sid}`,
      Cookie: cookie,
      Connection: "keep-alive",
    },
    maxBodyLength: Infinity,
    timeout: 120000,
  });

  const $res = load(data);

  // Coba beberapa kemungkinan selector, karena struktur halaman hasil upload
  // top4top.io bisa berbeda-beda (all_boxes / txtbox / class lain).
  let link =
    $res("input.all_boxes").first().attr("value")?.trim() ||
    $res('input[readonly]').first().attr("value")?.trim() ||
    null;

  // Fallback terakhir: cari pola URL top4top.io langsung di raw HTML
  if (!link || !/^https?:\/\/(?:\w+\.)?top4top\.io\/.+$/i.test(link)) {
    const urlMatch = data.match(/https?:\/\/[a-z0-9]+\.top4top\.io\/[^\s"'<>]+/i);
    if (urlMatch) link = urlMatch[0];
  }

  if (!link || !/^https?:\/\/(?:\w+\.)?top4top\.io\/.+$/i.test(link)) {
    console.error(
      "[top4top] Gagal menemukan link hasil upload. Potongan HTML respons (2000 char pertama):\n",
      data.slice(0, 2000)
    );
    throw new Error("Upload failed. Download link not found.");
  }

  return link;
}

module.exports = { uploadTop4Top };
