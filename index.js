require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { uploadTop4Top } = require("./top4top");
const { downloadYoutubeMp3, downloadAudioFromUrl } = require("./downloader");
const { searchYoutube } = require("./search");

// ---------- Safety net: jangan pernah biarkan bot crash total ----------
// Kalau ada Promise gagal yang tidak ke-catch (misal token webhook expired
// setelah proses terlalu lama), cukup log errornya, bot tetap jalan.
process.on("unhandledRejection", (reason) => {
  console.error("[UnhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UncaughtException]", err);
});

// ---------- Penyimpanan channel yang di-set, disimpan ke file JSON sederhana ----------
const CONFIG_PATH = path.join(__dirname, "channels.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let watchedChannels = loadConfig(); // { [guildId]: channelId }

// Cache sementara hasil /ytsearch (preview sebelum konfirmasi), key = customId unik.
// Otomatis dibersihkan setelah 5 menit untuk hemat memori.
const previewCache = new Map();
function cachePreview(key, data) {
  previewCache.set(key, data);
  setTimeout(() => previewCache.delete(key), 5 * 60 * 1000);
}

// ---------- Setup Discord Client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const YOUTUBE_REGEX =
  /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+(\S*)?/gi;

// ---------- Slash Command Definitions ----------
const commands = [
  new SlashCommandBuilder()
    .setName("setchanel")
    .setDescription("Set channel ini sebagai channel auto-convert YouTube ke Top4Top MP3")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unsetchanel")
    .setDescription("Matikan auto-convert di server ini")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ytsearch")
    .setDescription("Cari video YouTube dan pilih salah satu untuk digenerate ke link Top4Top")
    .addStringOption((option) =>
      option.setName("query").setDescription("Kata kunci pencarian").setRequired(true)
    )
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const appId = process.env.DISCORD_CLIENT_ID;

  if (!appId) {
    console.warn(
      "[WARNING] DISCORD_CLIENT_ID tidak diisi — slash command tidak bisa didaftarkan otomatis."
    );
    return;
  }

  try {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log("[Discord] Slash commands berhasil didaftarkan.");
  } catch (err) {
    console.error("[Discord] Gagal mendaftarkan slash commands:", err);
  }
}

// ---------- Fungsi reusable: download mp3 + upload ke Top4Top ----------
/**
 * @param {string} youtubeUrl
 * @param {(text: string) => Promise<void>} onProgress - callback untuk update pesan status
 * @returns {Promise<{title: string, directLink: string}>}
 */
async function processYoutubeToTop4Top(youtubeUrl, onProgress) {
  const { buffer, title } = await downloadYoutubeMp3(youtubeUrl);

  if (onProgress) await onProgress(`⏳ Audio "${title}" berhasil diunduh, mengunggah ke Top4Top...`);

  const safeFileName = `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60)}.mp3`;
  const directLink = await uploadTop4Top(buffer, safeFileName);

  return { title, directLink };
}

function buildResultEmbed(title, directLink) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`🎵 Link Top4Top MP3:\n${directLink}`)
    .setColor(0x2ecc71)
    .setFooter({ text: "Auto-converted by YT2Top4Top Bot" });
}

/**
 * Wrapper aman untuk interaction.editReply — kalau token webhook sudah
 * kedaluwarsa (proses terlalu lama, >15 menit) atau error lain, cukup log,
 * jangan sampai melempar exception yang bisa mematikan proses.
 */
async function safeEditReply(interaction, payload) {
  try {
    await interaction.editReply(payload);
  } catch (err) {
    console.error("[safeEditReply] Gagal mengedit balasan interaction:", err.message);
  }
}

/**
 * Wrapper aman untuk message.edit (dipakai di alur auto-detect channel).
 */
async function safeMessageEdit(message, payload) {
  try {
    await message.edit(payload);
  } catch (err) {
    console.error("[safeMessageEdit] Gagal mengedit pesan:", err.message);
  }
}

function buildPreviewEmbed(info) {
  const embed = new EmbedBuilder()
    .setTitle(info.title)
    .setColor(0x3498db)
    .setFooter({ text: "Konfirmasi untuk generate ke link Top4Top" });

  const fields = [];
  if (info.channel) fields.push({ name: "Channel", value: info.channel, inline: true });
  if (info.duration) fields.push({ name: "Durasi", value: info.duration, inline: true });
  if (typeof info.views === "number") {
    fields.push({ name: "Views", value: info.views.toLocaleString("id-ID"), inline: true });
  }
  if (info.uploaded) fields.push({ name: "Diunggah", value: info.uploaded, inline: true });

  if (fields.length) embed.addFields(fields);
  if (info.thumbnail) embed.setThumbnail(info.thumbnail);
  if (info.url) embed.setURL(info.url);

  return embed;
}

// ---------- Event: Ready ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`[Discord] Login sebagai ${c.user.tag}`);
  await registerCommands();
});

// ---------- Event: Slash Command & Select Menu ----------
client.on(Events.InteractionCreate, async (interaction) => {
  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setchanel") {
      watchedChannels[interaction.guildId] = interaction.channelId;
      saveConfig(watchedChannels);
      await interaction.reply({
        content: `✅ Channel ini (<#${interaction.channelId}>) sekarang jadi channel auto-convert YouTube → Top4Top MP3.`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "unsetchanel") {
      delete watchedChannels[interaction.guildId];
      saveConfig(watchedChannels);
      await interaction.reply({
        content: "✅ Auto-convert dimatikan untuk server ini.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "ytsearch") {
      const query = interaction.options.getString("query", true);
      await interaction.deferReply();

      let info;
      try {
        info = await searchYoutube(query);
      } catch (err) {
        console.error("[Error /ytsearch]", err);
        await safeEditReply(interaction, {
          content: `❌ Gagal mencari "${query}": ${err.message}`,
        });
        return;
      }

      const baseId = `ytsearch_${interaction.id}`;
      cachePreview(baseId, info);

      const confirmBtn = new ButtonBuilder()
        .setCustomId(`${baseId}_confirm`)
        .setLabel("✅ Konfirmasi & Generate")
        .setStyle(ButtonStyle.Success);

      const cancelBtn = new ButtonBuilder()
        .setCustomId(`${baseId}_cancel`)
        .setLabel("❌ Batal")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

      await safeEditReply(interaction, {
        embeds: [buildPreviewEmbed(info)],
        components: [row],
      });
      return;
    }
  }

  // --- Button (konfirmasi/batal hasil /ytsearch) ---
  if (interaction.isButton()) {
    const isConfirm = interaction.customId.endsWith("_confirm");
    const isCancel = interaction.customId.endsWith("_cancel");
    if (!isConfirm && !isCancel) return;

    const baseId = interaction.customId.replace(/_(confirm|cancel)$/, "");
    const info = previewCache.get(baseId);

    if (!info) {
      await interaction.update({
        content: "⚠️ Sesi pencarian ini sudah kedaluwarsa (lebih dari 5 menit). Jalankan `/ytsearch` lagi.",
        embeds: [],
        components: [],
      });
      return;
    }

    if (isCancel) {
      previewCache.delete(baseId);
      await interaction.update({
        content: "🚫 Dibatalkan.",
        embeds: [],
        components: [],
      });
      return;
    }

    // isConfirm
    previewCache.delete(baseId);
    await interaction.update({
      content: `⏳ Mengunduh audio "${info.title}"...`,
      embeds: [],
      components: [],
    });

    try {
      const buffer = await downloadAudioFromUrl(info.audioUrl);

      await safeEditReply(interaction, { content: `⏳ Mengunggah ke Top4Top...` });

      const safeFileName = `${info.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60)}.mp3`;
      const directLink = await uploadTop4Top(buffer, safeFileName);

      await safeEditReply(interaction, {
        content: null,
        embeds: [buildResultEmbed(info.title, directLink)],
      });
    } catch (err) {
      console.error("[Error saat generate dari /ytsearch]", err);
      await safeEditReply(interaction, { content: `❌ Gagal memproses: ${err.message}` });
    }
    return;
  }
});

// ---------- Event: Message Create (deteksi link YouTube) ----------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const targetChannelId = watchedChannels[message.guildId];
  if (!targetChannelId || message.channelId !== targetChannelId) return;

  const matches = message.content.match(YOUTUBE_REGEX);
  if (!matches || matches.length === 0) return;

  const youtubeUrl = matches[0];

  const processingMsg = await message.reply({
    content: "⏳ Memproses link YouTube... (download audio)",
  });

  try {
    const { title, directLink } = await processYoutubeToTop4Top(youtubeUrl, async (text) => {
      await safeMessageEdit(processingMsg, { content: text });
    });

    await safeMessageEdit(processingMsg, { content: null, embeds: [buildResultEmbed(title, directLink)] });
  } catch (err) {
    console.error("[Error saat memproses link]", err);
    await safeMessageEdit(processingMsg, {
      content: `❌ Gagal memproses link ini: ${err.message}`,
    });
  }
});

// ---------- Startup ----------
client.login(process.env.DISCORD_TOKEN);
  
