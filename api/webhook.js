const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const bot = new Telegraf(config.BOT_TOKEN);
const TEMP = '/tmp';

async function uploadToCatbox(filePath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filePath));
  if (config.USERHASH) form.append('userhash', config.USERHASH);

  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 90000,
  });

  const result = (res.data || '').toString().trim();
  if (!result.startsWith('https://')) throw new Error(result || 'Upload gagal');
  return result;
}

function getFile(msg) {
  if (msg.photo) {
    const p = msg.photo[msg.photo.length - 1];
    return { id: p.file_id, name: p.file_id + '.jpg', size: p.file_size || 0, type: 'photo' };
  }
  if (msg.video) return { id: msg.video.file_id, name: msg.video.file_name || 'video.mp4', size: msg.video.file_size || 0, type: 'video' };
  if (msg.document) return { id: msg.document.file_id, name: msg.document.file_name || 'file', size: msg.document.file_size || 0, type: 'document' };
  if (msg.audio) return { id: msg.audio.file_id, name: msg.audio.file_name || 'audio.mp3', size: msg.audio.file_size || 0, type: 'audio' };
  if (msg.voice) return { id: msg.voice.file_id, name: 'voice.ogg', size: msg.voice.file_size || 0, type: 'voice' };
  if (msg.animation) return { id: msg.animation.file_id, name: msg.animation.file_name || 'anim.gif', size: msg.animation.file_size || 0, type: 'gif' };
  if (msg.sticker) return { id: msg.sticker.file_id, name: 'sticker.webp', size: msg.sticker.file_size || 0, type: 'sticker' };
  return null;
}

// Notifikasi owner (background)
function notifyOwner(ctx, url, info) {
  const from = ctx.from?.username ? '@' + ctx.from.username : (ctx.from?.first_name || 'User');
  const text = `🔔 <b>Upload Bot</b>\n\n👤 ${from}\n📁 ${info.type}\n🔗 ${url}`;

  for (const id of config.OWNER_ID) {
    if (Number(id) === Number(ctx.from?.id)) continue;
    ctx.telegram.sendMessage(id, text, { parse_mode: 'HTML' }).catch(() => {});
  }
}

bot.on(['photo', 'video', 'document', 'audio', 'voice', 'animation', 'sticker'], async (ctx) => {
  let status, filePath;
  try {
    const info = getFile(ctx.message);
    if (!info) return ctx.reply('❌ File tidak didukung');
    if (info.size > config.MAX_FILE_SIZE) return ctx.reply('❌ Maksimal 200MB');

    status = await ctx.reply('⏳ Memproses...');

    const link = await ctx.telegram.getFileLink(info.id);
    filePath = path.join(TEMP, info.name);

    const res = await axios({ url: link.href, responseType: 'stream', timeout: 45000 });
    const writer = fs.createWriteStream(filePath);
    res.data.pipe(writer);
    await new Promise((r, j) => { writer.on('finish', r); writer.on('error', j); });

    const catboxUrl = await uploadToCatbox(filePath);
    try { fs.unlinkSync(filePath); } catch (e) {}

    // Kirim hasil dulu (biar user cepat dapat)
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      status.message_id,
      null,
      `✅ Berhasil!\n\n🔗 ${catboxUrl}`,
      Markup.inlineKeyboard([[Markup.button.callback('🗑 Hapus', `del_${status.message_id}`)]])
    );

    // Baru kirim ke owner (background)
    notifyOwner(ctx, catboxUrl, info);

  } catch (err) {
    if (filePath) try { fs.unlinkSync(filePath); } catch (e) {}
    const msg = `❌ Gagal: ${err.message}`;
    if (status) {
      try { await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, msg); }
      catch (e) { ctx.reply(msg); }
    } else ctx.reply(msg);
  }
});

bot.action(/del_(\d+)/, async (ctx) => {
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, parseInt(ctx.match[1]));
    await ctx.answerCbQuery('Dihapus');
  } catch (e) {
    await ctx.answerCbQuery('Gagal');
  }
});

bot.start((ctx) => ctx.reply('Kirim foto/video/dokumen untuk dapat link Catbox.'));
bot.help((ctx) => ctx.reply('Cukup kirim file ke bot ini.'));

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (e) {
    res.status(500).send('Error');
  }
};
