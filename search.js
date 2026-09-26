const axios = require("axios");

// Endpoint & API key sudah di-hardcode sesuai punya kamu.
const YT_SEARCH_ENDPOINT = "https://api.cuki.biz.id/api/search/playyt";
const YT_SEARCH_API_KEY = "cukimwah-6uwt05t";

/**
 * Cari video YouTube lewat API pribadi.
 * Struktur response API belum dipastikan persis, jadi fungsi ini defensif:
 * mencoba beberapa kemungkinan lokasi array hasil & field per-item.
 *
 * @param {string} query
 * @returns {Promise<Array<{title: string, url: string, videoId: string|null, thumbnail: string|null, duration: string|null, channel: string|null}>>}
 */
async function searchYoutube(query) {
  const url = `${YT_SEARCH_ENDPOINT}?apikey=${encodeURIComponent(
    YT_SEARCH_API_KEY
  )}&query=${encodeURIComponent(query)}`;

  const { data } = await axios.get(url, {
    headers: { "x-api-key": YT_SEARCH_API_KEY },
    timeout: 20000,
  });

  if (!data) throw new Error("API pencarian tidak mengembalikan data.");

  // Coba temukan array hasil di beberapa kemungkinan lokasi umum
  const rawList =
    data?.data?.results ||
    data?.data?.items ||
    data?.data ||
    data?.results ||
    data?.items ||
    (Array.isArray(data) ? data : null);

  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error("Tidak ada hasil pencarian ditemukan untuk query ini.");
  }

  const normalized = rawList
    .map((item) => {
      const videoId =
        item.videoId || item.id || item.video_id || extractVideoIdFromUrl(item.url || item.link);

      const url =
        item.url ||
        item.link ||
        (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);

      if (!url) return null;

      return {
        title: item.title || item.name || "Tanpa judul",
        url,
        videoId: videoId || null,
        thumbnail:
          item.thumbnail ||
          item.thumb ||
          item.image ||
          (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
        duration: item.duration || item.durationFormatted || item.length || null,
        channel: item.channel || item.author || item.uploader || null,
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("Hasil pencarian ditemukan tapi format datanya tidak dikenali.");
  }

  return normalized.slice(0, 10); // batasi max 10 (limit Discord select menu = 25, tapi 10 cukup & rapi)
}

function extractVideoIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
  return match ? match[1] : null;
}

module.exports = { searchYoutube };
  
