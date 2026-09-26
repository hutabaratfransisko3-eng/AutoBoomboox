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
  StringSelectMenuBuilder,
} = require("discord.js");

const { uploadTop4Top } = require("./top4top");
const { downloadYoutubeMp3 } = require("./downloader");
const { searchYoutube } = require("./search");

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

// Cache sementara hasil pencarian /ytsearch per interaction, supaya bisa diambil
// lagi saat user memilih item di select menu. Key = customId unik, value = hasil array.
// Otomatis dibersihkan setelah 5 menit untuk hemat memori.
const searchCache = new Map();
function cacheSearchResults(key, results) {
  searchCache.set(key, results);
  setTimeout(() => searchCache.delete(key), 5 * 60 * 1000);
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

      let results;
      try {
        results = await searchYoutube(query);
      } catch (err) {
        console.error("[Error /ytsearch]", err);
        await interaction.editReply({
          content: `❌ Gagal mencari "${query}": ${err.message}`,
        });
        return;
      }

      const selectId = `ytsearch_select_${interaction.id}`;
      cacheSearchResults(selectId, results);

      const menu = new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder("Pilih video yang mau digenerate ke Top4Top")
        .addOptions(
          results.map((item, idx) => ({
            label: item.title.slice(0, 100),
            description: [item.channel, item.duration].filter(Boolean).join(" • ").slice(0, 100) || undefined,
            value: String(idx),
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      const listText = results
        .map((item, idx) => `**${idx + 1}.** ${item.title}${item.duration ? ` \`(${item.duration})\`` : ""}`)
        .join("\n");

      await interaction.editReply({
        content: `🔎 Hasil pencarian untuk **${query}**:\n\n${listText}\n\nPilih salah satu di dropdown bawah ini:`,
        components: [row],
      });
      return;
    }
  }

  // --- Select menu (hasil pilihan /ytsearch) ---
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ytsearch_select_")) {
    const results = searchCache.get(interaction.customId);

    if (!results) {
      await interaction.update({
        content: "⚠️ Sesi pencarian ini sudah kedaluwarsa (lebih dari 5 menit). Jalankan `/ytsearch` lagi.",
        components: [],
      });
      return;
    }

    const chosenIndex = parseInt(interaction.values[0], 10);
    const chosen = results[chosenIndex];

    if (!chosen) {
      await interaction.update({ content: "⚠️ Pilihan tidak valid.", components: [] });
      return;
    }

    await interaction.update({
      content: `⏳ Memproses **${chosen.title}**... (download audio)`,
      components: [],
    });

    try {
      const { title, directLink } = await processYoutubeToTop4Top(chosen.url, async (text) => {
        await interaction.editReply({ content: text });
      });

      await interaction.editReply({ content: null, embeds: [buildResultEmbed(title, directLink)] });
    } catch (err) {
      console.error("[Error saat memproses pilihan /ytsearch]", err);
      await interaction.editReply({ content: `❌ Gagal memproses video ini: ${err.message}` });
    }

    searchCache.delete(interaction.customId);
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
      await processingMsg.edit({ content: text });
    });

    await processingMsg.edit({ content: null, embeds: [buildResultEmbed(title, directLink)] });
  } catch (err) {
    console.error("[Error saat memproses link]", err);
    await processingMsg.edit({
      content: `❌ Gagal memproses link ini: ${err.message}`,
    });
  }
});

// ---------- Startup ----------
client.login(process.env.DISCORD_TOKEN);
