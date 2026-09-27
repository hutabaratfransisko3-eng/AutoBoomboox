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

  let response;
  try {
    response = await axios.get(requestUrl, { timeout: 30000 });
  } catch (err) {
    // Axios melempar exception untuk status non-2xx (misal 500). Ambil pesan
    // error asli dari body API kalau tersedia, biar informasinya jelas ke user.
    const apiMessage = err.response?.data?.error || err.response?.data?.message;
    throw new Error(
      apiMessage
        ? `API downloader error: ${apiMessage}`
        : `API downloader gagal diakses (${err.message}).`
    );
  }

  const data = response.data;

  if (!data || data.success !== true || data.statusCode !== 200) {
    const apiMessage = data?.error || data?.message;
    throw new Error(
      apiMessage ? `API downloader gagal: ${apiMessage}` : "API downloader gagal memproses link ini."
    );
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
