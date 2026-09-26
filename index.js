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
} = require("discord.js");

const { uploadTop4Top } = require("./top4top");
const { downloadYoutubeMp3 } = require("./downloader");

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

// ---------- Event: Ready ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`[Discord] Login sebagai ${c.user.tag}`);
  await registerCommands();
});

// ---------- Event: Slash Command ----------
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setchanel") {
    watchedChannels[interaction.guildId] = interaction.channelId;
    saveConfig(watchedChannels);
    await interaction.reply({
      content: `✅ Channel ini (<#${interaction.channelId}>) sekarang jadi channel auto-convert YouTube → Top4Top MP3.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "unsetchanel") {
    delete watchedChannels[interaction.guildId];
    saveConfig(watchedChannels);
    await interaction.reply({
      content: "✅ Auto-convert dimatikan untuk server ini.",
      ephemeral: true,
    });
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
    // 1. Download mp3 dari API pribadi
    const { buffer, title } = await downloadYoutubeMp3(youtubeUrl);

    await processingMsg.edit({
      content: `⏳ Audio "${title}" berhasil diunduh, mengunggah ke Top4Top...`,
    });

    // 2. Upload langsung ke Top4Top via HTTP
    const safeFileName = `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60)}.mp3`;
    const directLink = await uploadTop4Top(buffer, safeFileName);

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(`🎵 Link Top4Top MP3:\n${directLink}`)
      .setColor(0x2ecc71)
      .setFooter({ text: "Auto-converted by YT2Top4Top Bot" });

    await processingMsg.edit({ content: null, embeds: [embed] });
  } catch (err) {
    console.error("[Error saat memproses link]", err);
    await processingMsg.edit({
      content: `❌ Gagal memproses link ini: ${err.message}`,
    });
  }
});

// ---------- Startup ----------
client.login(process.env.DISCORD_TOKEN);
