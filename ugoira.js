const axios = require('axios');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const GIFEncoder = require('gif-encoder-2');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const logger = pino({
    transport: {
        target: 'pino-pretty'
    },
});

/**
 * 下载 Pixiv Ugoira 动图并合成为 GIF
 * @param {string|number} illustId Pixiv 作品ID
 * @returns {Promise<string>} 返回生成的 GIF 文件的相对路径
 */
async function downloadUgoiraToGif(illustId) {
    // 初始化并检查输出目录
    const outputDir = path.join(__dirname, 'pixiv_ugoira');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const gifOutputPath = path.join(outputDir, `${illustId}.gif`);

    if (fs.existsSync(gifOutputPath)) {
        logger.info(`[Ugoira.js] 作品 ID: ${illustId} 已存在本地缓存，直接命中。`);
        return path.relative(process.cwd(), gifOutputPath);
    }


    const cookieString = process.env.Cookies;
    const metaUrl = `https://www.pixiv.net/ajax/illust/${illustId}/ugoira_meta`;
    const metaResponse = await axios.get(metaUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.pixiv.net/',
            'Cookie': cookieString // 注入登录凭证
        }
    });

    if (metaResponse.data.error) {
        throw new Error(`Pixiv API 报错: ${metaResponse.data.message} (请检查 Cookie 是否过期)`);
    }

    const { src, frames } = metaResponse.data.body;
    const mirrorSrc = src.replace('i.pximg.net', 'i.pixiv.re');

    // 本地所需文件夹
    const tempDir = path.join(__dirname, 'temp', String(illustId));
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    try {
        // 从镜像站下载压缩包并解压
        logger.info("[Ugoira.js] 下载动图压缩包: " + mirrorSrc);
        const zipResponse = await axios.get(mirrorSrc, { responseType: 'arraybuffer' });
        const zipBuffer = Buffer.from(zipResponse.data);
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(tempDir, true);

        // 初始化 GIF 编码器
        logger.info("[Ugoira.js] 初始化GIF编码器");
        const firstFramePath = path.join(tempDir, frames[0].file);
        const { width, height } = await sharp(firstFramePath).metadata();

        const encoder = new GIFEncoder(width, height);
        const writeStream = fs.createWriteStream(gifOutputPath);

        encoder.createReadStream().pipe(writeStream);
        encoder.start();
        encoder.setRepeat(0);
        encoder.setQuality(10);

        // 依次合成每一帧
        logger.info("[Ugoira.js] 将帧合成为GIF");
        for (const frame of frames) {
            const framePath = path.join(tempDir, frame.file);

            const rgbaBuffer = await sharp(framePath)
                .ensureAlpha()
                .raw()
                .toBuffer();

            encoder.setDelay(frame.delay);
            encoder.addFrame(rgbaBuffer);
        }
        encoder.finish();

        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

    } finally {
        // 清理临时目录
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        logger.info("[Ugoira.js] 已清理temp目录，任务结束");
    }

    return path.relative(process.cwd(), gifOutputPath);
}

module.exports = downloadUgoiraToGif;