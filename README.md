# 中英对照书架 · 尤利西斯 / 喧哗与骚动

支持选书的中英对照阅读网页。点左上角书名或“选书”，切换两本书；每本书分别保存阅读位置、滚动位置和笔记，刷新后继续阅读。原有《尤利西斯》笔记的存储键保持不变。

- **尤利西斯 / Ulysses · James Joyce**：用户提供的 PDF 全部 267 页正文，对应 PDF 第 5–271 页（前 4 页为前置内容）。覆盖前 10 章及第 11 章“塞壬”的一部分，并非整部小说。
- **喧哗与骚动 / The Sound and the Fury · William Faulkner**：英文全本，按原作日期分四个部分，3,160 段原文，保留原版斜体。来源为 [Project Gutenberg #75170](https://www.gutenberg.org/ebooks/75170)，仓库内同时保留[英文全文及原始使用说明](books/the-sound-and-the-fury-en.txt)。按完整段落重排为 304 个阅读页，不对应纸书页码。中文由 Google Translate 机器翻译，统一主要人名并抽查修正了 25 段；尚未逐句文学审校，不能保证双关、方言、典故和意识流句法的准确性。

- 手机横屏时，左侧英文、右侧中文，逐段对照。
- 顶部“目录”只显示当前书的章节或部分。《尤利西斯》保留 PDF 页码，《喧哗与骚动》按四个日期部分跳转，页码标为阅读页。
- 每章独立页码与阅读进度，读完可直接进入下一章。PDF 页内的章节交界按段落切分，保留原 PDF 页码。支持字号调整。
- 书本式版面：纸张纹理、书脊阴影与页边叠页、首字下沉、两端对齐；顶部“背景”可切换米白纸张、羊皮纸、护眼豆绿、纯白、夜间五种风格，选择会记在浏览器本地。
- 竖屏时按段落上下排列。
- 点击（触屏轻点）英文单词立即用浏览器自带的英语语音朗读，不需要联网；不会弹出查词卡片。想查词：手机长按单词约半秒，电脑长按或右键单词。查词卡片里的“美式录音 / 英式录音”按钮播放 [Free Dictionary API](https://dictionaryapi.dev/) 的真人录音（来自 Wikimedia / Wiktionary，CC BY-SA 4.0），并显示音标；录音结果在浏览器本地缓存 7 天，只发送所点的单词。
- 每个英文段落末尾有白色小狗 ♪ 按钮，点击用浏览器自带的英语语音逐句朗读整段，读的过程中该段会高亮，再点一次停止；翻页时自动停止。
- 笔记本：查词卡片里点“☆ 加入笔记本”收藏单词（自动带上释义和所在句子）；点段落末尾的 ✎ 进入选句模式，点句子即可收藏或取消，再点“完成”退出。已收藏的单词带虚线下划线，已收藏的句子有底色。顶部“笔记”打开笔记本，可分单词/句子查看、朗读、查词、跳回原文、删除，也可复制全部或导出 CSV（Excel、Anki 可导入）。笔记只保存在本机浏览器的 localStorage，不上传，清除浏览器数据或换设备会丢失，请定期导出。
- 长按（电脑也可右键）英文单词，直接加载在线词义、构词与词源。
- 顶部“查词”支持任意英文单词、前缀与后缀（例如 `unbelievable`、`un-`、`-able`），查询范围不受已加载正文限制。
- 词源中提到的英语词素与词典明确标注的原形可以继续点查，并可返回上一个词。
- 词义与词源分栏展示。中文未收录时显示英文原文；没有词源时明确提示，不自动猜测拆词。

## 预生成的段落朗读（访客无需密钥）

小狗按钮的朗读顺序：当前这本书预生成的 MP3 → 浏览器自带语音。《尤利西斯》的音频在 `audio/`（目前覆盖前 100 页），《喧哗与骚动》的音频在 `audio/sound-and-fury/`（全书），两本书各有自己的 `manifest.json`，互不混用。预生成音频由 `tools/generate-audio.mjs` 调用 Google Cloud Text-to-Speech 一次性生成，随网站发布，访客不需要密钥，也不产生后续调用费用。

在自己电脑上运行（需要 Node 18+；密钥只从环境变量读取，不会写入任何文件，也不要提交到仓库）：

```
export GOOGLE_TTS_API_KEY=你的密钥        # Windows PowerShell: $env:GOOGLE_TTS_API_KEY="你的密钥"
node tools/generate-audio.mjs --dry-run   # 只统计字符数，不发请求（前 100 页约 21 万字符）
node tools/generate-audio.mjs --pages 1-3 # 先生成前几页试听
node tools/generate-audio.mjs             # 生成全部；已生成的会跳过，可中断后继续
node tools/generate-audio.mjs --book sound-and-fury   # 《喧哗与骚动》（约 50 万字符）；默认书是 ulysses
```

可选参数：`--voice en-GB-Chirp3-HD-Charon`（默认 `en-US-Chirp3-HD-Aoede`，美式女声）、`--rate 0.95`、`--concurrency 3`。生成后把 `audio/` 目录提交并推送。段落文字被修改后，对应文件名（含文本哈希）不再匹配，会自动退回其他朗读方式，重新运行脚本即可补生成。费用和免费额度以 Google 官方定价为准；密钥需要在 Google Cloud 启用 Text-to-Speech API，并建议限制为只能调用该 API。

## 在线词典

网页直接通过 [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Parsing_wikitext) 查询英语和中文 Wiktionary 的英语词条，不需要账号、API 密钥或后端服务器。只发送所查词形，不发送正文或阅读历史。遵循接口限流，支持取消过期请求、超时提示和手动重试。查询过的在线词条在浏览器本地缓存最多 24 小时；“重新查询”可更新。

词典文本摘录并重新排版自 **Wiktionary 贡献者**，按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 使用，卡片内提供各条来源链接。多词源分别保留；词素按钮表示原词源中提及，不将所有关联词硬拼成构词公式。词典没有收录的词、专名或造词可能查不到；可打开完整 Wiktionary 或 Etymonline 补充查询。

前五页的中文阅读笔记仅作为“本书中文提示”保留，不充当在线词典结果。后续增加正文不会限制在线查词范围。

实现分为 `dictionary-parser.js`（提取词源与释义）、`dictionary-client.js`（联网与缓存）、`reader.js`（阅读交互）。接口只提取纯文本，不把外部 HTML 插入页面。相关规范：[跨域访问](https://www.mediawiki.org/wiki/API:Cross-site_requests)、[API 使用规范](https://www.mediawiki.org/wiki/API:Etiquette)、[Wiktionary 许可](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)。

《尤利西斯》中文为 AI 辅助译文，仅供对照阅读。英文依据 Lerner 2016 版的用户提供 PDF，按原 PDF 分页，保留跨页段落和诗歌换行。正文第 1 页对应 PDF 第 5 页，正文第 267 页对应 PDF 第 271 页。PDF 第 53 页起进入第二部。

译文逐段生成并核对覆盖范围，尚未经专业文学译者逐句审校；原作的双关、典故和方言可能有其他译法。仅渲染当前页，翻页与联网查词不随总页数增加而创建整本书的页面节点。

## 在线阅读

https://qiangwu769.github.io/ulysses-bilingual-reader/

## 部署

这是无需构建的静态网站。GitHub Pages 使用 `main` 分支根目录的 `index.html`。

## 章节边界

章节按原文开篇定位，参考 [1922 年版原文](https://en.wikisource.org/wiki/Ulysses_(1922))；目录使用通行的荷马式章名。`chapter-data` 只保存边界，原 `reader-data` 的 267 页、3,946 组中英段落未改动。9 处页内章界拆为独立阅读片段，合计 276 个章内阅读页；段落仍使用原始页号、段落序号和文本哈希匹配预生成音频。

## 书籍数据

《尤利西斯》原有正文仍在 `index.html` 的 `reader-data` 中，未改动。《喧哗与骚动》数据放在 `books/sound-and-fury.json`，首次选书时下载；加载失败可重试，并保留当前书。切换和翻页只渲染当前页。阅读记录和笔记保存在本机浏览器，各书独立；CSV 导出包含书名。
