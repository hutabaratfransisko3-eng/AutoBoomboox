const axios = require("axios");

// Endpoint & API key sudah di-hardcode sesuai punya kamu.
const YT_API_ENDPOINT = "https://api.cuki.biz.id/api/downloader/ytmp3";
const YT_API_KEY = "cukimwah-7ncde5a";
const YT_API_QUALITY = "192";

/**
 * Panggil API downloader YouTube pribadi, kembalikan buffer mp3 + judul.
 * @param {string} youtubeUrl
 * @returns {Promise<{buffer: Buffer, title: string}>}
 */
async function downloadYoutubeMp3(youtubeUrl) {
  const params = new URLSearchParams({
    apikey: YT_API_KEY,
    url: youtubeUrl,
    quality: YT_API_QUALITY,
  });

  const requestUrl = `${YT_API_ENDPOINT}?${params.toString()}`;

  const { data } = await axios.get(requestUrl, { timeout: 30000 });

  if (!data || data.success !== true || data.statusCode !== 200) {
    throw new Error("API downloader gagal memproses link ini.");
  }

  const downloadUrl = data?.data?.audio?.download?.downloadUrl;
  const title = data?.data?.metadata?.title || "audio";

  if (!downloadUrl) throw new Error("API downloader tidak mengembalikan downloadUrl.");

  // Unduh file mp3 aktual dari CDN
  const fileResponse = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });

  return {
    buffer: Buffer.from(fileResponse.data),
    title,
  };
}

/**
 * Unduh file mp3 langsung dari URL audio yang sudah didapat (misalnya dari hasil /ytsearch).
 * @param {string} audioUrl
 * @returns {Promise<Buffer>}
 */
async function downloadAudioFromUrl(audioUrl) {
  const fileResponse = await axios.get(audioUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  return Buffer.from(fileResponse.data);
}

module.exports = { downloadYoutubeMp3, downloadAudioFromUrl };
