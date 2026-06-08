const axios = require("axios");
const TelegramBot = require('node-telegram-bot-api');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');
const downloadUgoiraToGif = require('./ugoira.js');
const { config } = require("dotenv");
const logger = pino({
  transport: {
    target: 'pino-pretty'
  },
});
dayjs.extend(utc);
dayjs.extend(timezone);
require('dotenv').config();

const token = process.env.BotToken;  // Telegram Bot Token
const channelId = process.env.ChannelId;  // 获取到的图片将发送到该频道
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";  // 访问网页时的UA标识

const bot = new TelegramBot(token, { polling: true });
bot.on('polling_error', (error) => {
  logger.error(error.code);
});

function escapeMdV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function getImageUrlPixiv(element) {
  return element.urls.regular.replace("//i.pximg.net/", "//i.pixiv.re/");
}

// 通过用户发来的URL保存图片
bot.onText(/(https?):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]/, (msg) => {
  const chatId = msg.chat.id;
  logger.info("接收到新消息，用户ID: " + chatId + "，内容: " + msg.text);

  // 1. 检测是否来自Pixiv
  let pixivArtworkId = msg.text.match(/(?<=pixiv\.net\/artworks\/)[0-9]*/);
  if (pixivArtworkId != "" && pixivArtworkId != null) {
    logger.info("检测到Pixiv图片，即将请求图片信息");
    bot.sendMessage(chatId, "⚡*LightningSave \\- Pixiv*\n检测到Pixiv链接，任务正在进行。\n如果30秒内未响应，请检查运行日志。动图等大型媒体可能需要数分钟来上传。", { caption: caption, parse_mode: "MarkdownV2" });
    var caption = "Null";
    const cookieString = process.env.Cookies.trim();
    // 获取图片信息
    axios.get("https://www.pixiv.net/ajax/illust/" + pixivArtworkId, {
      timeout: 5000,
      headers: {
        'Cookie': cookieString,
        'User-Agent': userAgent
      }
    }).then((response) => {
      // 检测返回值是否为JSON，是则解析
      if (typeof response.data !== "object") {
        try {
          JSON.parse(response.data)
        } catch (error) {
          logger.error("解析API返回值时出错:");
          console.log(error);
          bot.sendMessage(chatId, "遇到网络错误，请重试。");
          return;
        }
      }
      const info = response.data.body;

      // 将作品标签以逗号分隔
      let tags = "";
      info.tags.tags.forEach(element => {
        tags = tags + (tags == "" ? "" : ", ") + element.tag;
      });

      // 生成描述文本
      caption = `*标题:*  [${escapeMdV2(info.title)}](https://www.pixiv.net/artworks/${pixivArtworkId})
*标签:*  \`${escapeMdV2(tags)}\`
*作者:*  [${escapeMdV2(info.userName)}](https://www.pixiv.net/users/${info.userId})
*上传:*  \`${escapeMdV2(dayjs(info.uploadDate).tz("Asia/Shanghai").format('YYYY-MM-DD HH:mm:ss'))} UTC+8\`
*数据:*  🙂 ${info.likeCount}  *\\|*  ❤ ${info.bookmarkCount}  *\\|*  👀 ${info.viewCount}
*平台:*  pixiv

_Powered by LightningSave ${escapeMdV2(pkg.version)}_`;

      // 判断是否为ugoria动图
      if (info.urls.original.includes("_ugoira0") === false) {
        // 发送普通图片
        logger.info("常规Pixiv图片");
        axios("https://www.pixiv.net/ajax/illust/" + pixivArtworkId + "/pages",
          {
            timeout: 3000,
            headers: {
              'Cookie': cookieString,
              'User-Agent': userAgent
            }
          }
        ).then((response) => {
          // 检测返回值是否为JSON，是则解析
          if (typeof response.data !== "object") {
            try {
              JSON.parse(response.data);
            } catch (error) {
              logger.error("解析API返回值时出错:");
              console.log(error);
              bot.sendMessage(chatId, "遇到网络错误，请重试。");
              return;
            }
          }
          const imageList = response.data.body;

          // 1张图片用sendPhoto，2到10张用sendMediaGroup 
          if (imageList.length > 1 && imageList.length <= 10) {
            let mediaGroup = [];
            imageList.forEach(image => {
              mediaGroup.push(
                {
                  type: "photo",
                  media: getImageUrlPixiv(image)
                }
              );
            });
            mediaGroup[0].caption = caption;  // 首张图片的描述将被设为整条消息的描述
            mediaGroup[0].parse_mode = 'MarkdownV2';
            logger.info("即将发送MediaGroup:\n" + JSON.stringify(mediaGroup));
            bot.sendMediaGroup(channelId, mediaGroup);
          } else if (imageList.length > 10) {
            // 图片超过10张，需要分批发送 
            for (let groupNum = 0; groupNum < Math.ceil(imageList.length / 10); groupNum++) {
              // 以每组10张图片，将imageList分成若干组
              let mediaGroup = [];
              for (let imageNum = groupNum * 10; imageNum <= groupNum * 10 + 9; imageNum++) {
                if (imageNum > imageList.length - 1) break;
                mediaGroup.push(
                  {
                    type: "photo",
                    media: getImageUrlPixiv(imageList[imageNum])
                  }
                );
              }
              // 单独生成描述，因为要显示分组
              caption = `*图片组:*  第${groupNum + 1}/${Math.ceil(imageList.length / 10)}组 \\(共${imageList.length}张\\)

*标题:*  [${escapeMdV2(info.title)}](https://www.pixiv.net/artworks/${pixivArtworkId})
*标签:*  \`${escapeMdV2(tags)}\`
*作者:*  [${escapeMdV2(info.userName)}](https://www.pixiv.net/users/${info.userId})
*上传:*  \`${escapeMdV2(dayjs(info.uploadDate).tz("Asia/Shanghai").format('YYYY-MM-DD HH:mm:ss'))} UTC+8\`
*数据:*  🙂 ${info.likeCount}  *\\|*  ❤ ${info.bookmarkCount}  *\\|*  👀 ${info.viewCount}
*平台:*  pixiv

_Powered by LightningSave ${escapeMdV2(pkg.version)}_`;
              mediaGroup[0].caption = caption;  // 首张图片的描述将被设为整条消息的描述
              mediaGroup[0].parse_mode = 'MarkdownV2';
              logger.info("即将发送MediaGroup，组号" + groupNum + "，共" + Math.ceil(imageList.length / 10) + "组:");
              logger.info(JSON.stringify(mediaGroup));
              bot.sendMediaGroup(channelId, mediaGroup);
            }
          } else {
            logger.info("即将发送图片");
            bot.sendPhoto(channelId, getImageUrlPixiv(imageList[0]), { caption: caption, parse_mode: "MarkdownV2" })
          }
        }).catch(error => {
          // 错误处理
          logger.error("成功获取作品信息，但是无法获取图片URL:");
          console.log(error);
          bot.sendMessage(chatId, "⚠ 获取图片URL时出错:" + escapeMdV2(error.status + " " + error.statusText) + "\n如果是404，可能是因为未登录，请重新配置Cookies。", { parse_mode: "MarkdownV2" });
        });
      } else {
        // 发送ugoira动图
        logger.info("动态Pixiv图片(ugoira)");
        (async () => {
          try {
            logger.info("即将处理并发送Ugoria图片");
            const relativePath = await downloadUgoiraToGif(pixivArtworkId);
            bot.sendAnimation(channelId, relativePath, { caption: caption, parse_mode: "MarkdownV2" });
          } catch (err) {
            // 错误处理
            logger.error("发送 Pixiv Ugoria 图片时出错:\n" + err.message);
            bot.sendMessage(chatId, "⚠ 发送 Pixiv Ugoria 图片时出错:\n>" + escapeMdV2(err.message), { parse_mode: "MarkdownV2" });
          }
        })();
      }
    }).catch(error => {
      // 错误处理
      if (error.response) {
        if (error.response.status == 404) {
          logger.info("所请求的Pixiv内容不存在");
          bot.sendMessage(chatId, "⚠ 该内容不存在(404)，请检查链接是否有效。");
        } else {
          logger.error("请求Pixiv时出错:");
          console.log(error);
          bot.sendMessage(chatId, "⚠ 网络请求出错，请检查运行日志");
        }
      }
      logger.error("请求Pixiv时出错，可能是网络问题:");
      console.log(error);
    });
  } else {
    bot.sendMessage(chatId, `🤔 *LightningSave 不支持此链接*
请确保您发送的是受支持的链接，并且以\`https://\`开头，最好删除除了目标链接外的文本。
当前版本: ${escapeMdV2(pkg.version)}
访问 [GitHub](https://github.com/yzl3014/LightningSave) 以检查更新`, { parse_mode: "MarkdownV2", link_preview_options: `{"is_disabled":true}` });
  }
});

// 清除缓存
bot.onText(/\/clean/, (msg) => {
  const chatId = msg.chat.id;
  logger.info("用户准备清除缓存, 用户ID: " + chatId);
  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '立即删除', callback_data: 'clean_confirm' },
          { text: '取消', callback_data: 'clean_cancel' }
        ]
      ]
    }
  };
  bot.sendMessage(
    chatId,
    `*⚠️ LightningSave 即将清空缓存：*
你确定要清空 \`pixiv_ugoira\`  和 \`temp\` 目录吗？此操作不可逆！
\`pixiv_ugoira\` 包含曾保存过的 ugoira 动图。删除后，已上传至 Telegram 的图片不受影响。
\`temp\` 包含保存 ugoira 动图时的缓存文件。这些缓存通常会在图片保存完成后被清空。`,
    { parse_mode: 'MarkdownV2', ...inlineKeyboard }
  );
});

// 清除缓存：监听按钮点击事件
bot.on('callback_query', async (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const action = callbackQuery.data; // 获取点击按钮传入的 callback_data
  const userId = callbackQuery.from.id; // 点击按钮的用户 ID
  logger.info("按钮点击事件");

  /* 只允许发送 /clean 命令的人触发按钮
  if (callbackQuery.from.id !== message.reply_to_message?.from.id) {
    return;
  }*/

  if (action === 'clean_confirm') {
    try {
      // 执行清理
      const targetDirs = ['pixiv_ugoira', 'temp'];

      targetDirs.forEach(dirName => {
        const dirPath = path.join(process.cwd(), dirName);

        if (fs.existsSync(dirPath)) {
          // 递归强制删除目录及其内容
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
        // 重新创建该空目录
        fs.mkdirSync(dirPath, { recursive: true });
      });

      // 1. 回应 Telegram 服务器，消除按钮的加载动画状态
      await bot.answerCallbackQuery(callbackQuery.id, { text: '清理成功！' });

      // 2. 修改原消息，移除按钮并显示成功提示
      await bot.editMessageText('🧹 目录 `pixiv_ugoira` 和 `temp` 已成功清空。', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('清理目录时出错:', error);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ 清理失败，请检查日志', show_alert: true });
      await bot.editMessageText(`❌ 清理过程中发生错误: ${error.message}`, {
        chat_id: chatId,
        message_id: messageId
      });
    }
  }

  else if (action === 'clean_cancel') {
    // 取消操作
    await bot.answerCallbackQuery(callbackQuery.id, { text: '操作已取消' });
    await bot.editMessageText('✅ 操作已取消，未删除任何文件。', {
      chat_id: chatId,
      message_id: messageId
    });
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "*⚡ LightningSave 正在运行*\n如果你能看到这条消息，则证明程序正在运行。\n访问[ GitHub 仓库 ](https://github.com/yzl3014/LightningSave)查看功能。", { parse_mode: "MarkdownV2", link_preview_options: `{"is_disabled":true}` });
});

// 检测Cookies是否有效
function cookiesTest() {
  const content = process.env.Cookies.trim();
  if (!content) {
    logger.error("环境变量 Cookies 不存在，网络请求将无法进行");
    return false;
  }
  const isValid = (/^[^=;\s]+=[^;]*(;\s+[^=;\s]+=[^;]*)*;?$/).test(content);
  if (isValid === false) {
    logger.warn("环境变量 Cookies 与要求不符，网络请求可能无法进行");
  }
}



cookiesTest();
if (process.stdout.isTTY) {
  if (process.stdout.columns >= 86) {
    logger.info("    __     _         __     __          _              ");
    logger.info("   / /    (_)____ _ / /_   / /_ ____   (_)____   ____ _");
    logger.info("  / /    / // __ `// __ \\ / __// __ \\ / // __ \\ / __ `/");
    logger.info(" / /___ / // /_/ // / / // /_ / / / // // / / // /_/ / ");
    logger.info("/_____//_/ \\__, //_/ /_/ \\__//_/ /_//_//_/ /_/ \\__, /  ");
    logger.info("          /____/ _____                        /____/   ");
    logger.info("                / ___/ ____ _ _   __ ___               ");
    logger.info("                \\__ \\ / __ `/| | / // _ \\              ");
    logger.info("               ___/ // /_/ / | |/ //  __/              ");
    logger.info("              /____/ \\__,_/  |___/ \\___/               ");
    logger.info("        https://github.com/yzl3014/LightningSave\n");
  }
}
logger.info("LightningSave is running. Version: " + pkg.version);