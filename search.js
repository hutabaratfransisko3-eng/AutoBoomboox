const axios = require("axios");

// Endpoint & API key sudah di-hardcode sesuai punya kamu.
const YT_SEARCH_ENDPOINT = "https://api.cuki.biz.id/api/search/playyt";
const YT_SEARCH_API_KEY = "cukimwah-6uwt05t";

/**
 * Cari 1 video YouTube via API pribadi. API ini unik: sekali panggil langsung
 * mengembalikan metadata video TERBAIK yang cocok DAN link mp3 hasil convert-nya
 * sekaligus (tidak perlu panggil endpoint ytmp3 terpisah lagi).
 *
 * @param {string} query
 * @returns {Promise<{
 *   videoId: string, title: string, url: string, thumbnail: string|null,
 *   channel: string|null, duration: string|null, views: number|null, uploaded: string|null,
 *   audioUrl: string, audioFilename: string
 * }>}
 */
async function searchYoutube(query) {
  const url = `${YT_SEARCH_ENDPOINT}?apikey=${encodeURIComponent(
    YT_SEARCH_API_KEY
  )}&query=${encodeURIComponent(query)}`;

  const { data } = await axios.get(url, {
    headers: { "x-api-key": YT_SEARCH_API_KEY },
    timeout: 30000,
  });

  if (!data || data.success !== true || data.statusCode !== 200) {
    throw new Error("Tidak ada hasil pencarian ditemukan untuk query ini.");
  }

  const video = data?.data?.video;
  const download = data?.data?.download;
  const audio = download?.audio;

  if (!video || !download?.success || !audio?.url) {
    throw new Error("API tidak mengembalikan hasil video/audio yang valid.");
  }

  return {
    videoId: video.videoId,
    title: video.title || "Tanpa judul",
    url: video.url,
    thumbnail: video.thumbnail?.default || null,
    channel: video.author?.name || null,
    duration: video.duration?.timestamp || video.duration?.formatted || null,
    views: typeof video.views === "number" ? video.views : null,
    uploaded: video.uploaded || null,
    audioUrl: audio.url,
    audioFilename: audio.filename || `${video.title || "audio"}.mp3`,
  };
}

module.exports = { searchYoutube };
