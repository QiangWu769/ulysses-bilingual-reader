# 尤利西斯 · 中英对照阅读

James Joyce《Ulysses》正文前 100 页的中英对照阅读网页，对应提供的 PDF 第 5–104 页。

- 手机横屏时，左侧英文、右侧中文，逐段对照。
- 支持翻页、页码选择与字号调整。
- 书本式版面：纸张纹理、书脊阴影与页边叠页、首字下沉、两端对齐；顶部“背景”可切换米白纸张、羊皮纸、护眼豆绿、纯白、夜间五种风格，选择会记在浏览器本地。
- 竖屏时按段落上下排列。
- 点击（触屏轻点）英文单词即可发音：优先播放 [Free Dictionary API](https://dictionaryapi.dev/) 提供的真人录音（美式/英式，来自 Wikimedia / Wiktionary，CC BY-SA 4.0），没有录音、超时或离线时自动改用浏览器自带的英语语音。查词卡片显示音标，并可分别播放美式、英式录音（选择会记住）；词缀会去掉连字符后用系统语音朗读。录音结果在浏览器本地缓存 7 天，只发送所点的单词。
- 每个英文段落末尾有白色小狗 ♪ 按钮，点击用浏览器自带的英语语音逐句朗读整段，读的过程中该段会高亮，再点一次停止；翻页时自动停止。
- 可选的 AI 朗读：顶部“设置 → AI 语音设置”粘贴自己的 Google Gemini API 密钥并启用后，点单词和小狗按钮都改用 Gemini 语音朗读（单词失败时依次退回真人录音、系统语音；查词卡片的美式/英式录音按钮始终播放真人录音；默认模型 `gemini-3.8-flash-tts`，可改模型和声音）。密钥只存在本机浏览器的 localStorage，请求直接发往 Google，不经过本站；生成过的段落缓存在本机 IndexedDB。未启用、没有密钥或出错（无效密钥、额度用完、断网、超过 45 秒）时自动改用系统语音。免费层的文本可能被 Google 用于改进产品，额度与价格以 Google 官方为准。
- 长按英文单词约半秒，直接加载在线词义、构词与词源；电脑可直接点击。
- 顶部“查词”支持任意英文单词、前缀与后缀（例如 `unbelievable`、`un-`、`-able`），查询范围不受已加载正文限制。
- 词源中提到的英语词素与词典明确标注的原形可以继续点查，并可返回上一个词。
- 词义与词源分栏展示。中文未收录时显示英文原文；没有词源时明确提示，不自动猜测拆词。

## 预生成的段落朗读（访客无需密钥）

小狗按钮的朗读顺序：`audio/` 里预生成的 MP3 → 访客自己配置的 Gemini 语音（可选）→ 浏览器自带语音。预生成音频由 `tools/generate-audio.mjs` 调用 Google Cloud Text-to-Speech 一次性生成，随网站发布，访客不需要密钥，也不产生后续调用费用。

在自己电脑上运行（需要 Node 18+；密钥只从环境变量读取，不会写入任何文件，也不要提交到仓库）：

```
export GOOGLE_TTS_API_KEY=你的密钥        # Windows PowerShell: $env:GOOGLE_TTS_API_KEY="你的密钥"
node tools/generate-audio.mjs --dry-run   # 只统计字符数，不发请求（前 100 页约 21 万字符）
node tools/generate-audio.mjs --pages 1-3 # 先生成前几页试听
node tools/generate-audio.mjs             # 生成全部；已生成的会跳过，可中断后继续
```

可选参数：`--voice en-US-Chirp3-HD-Aoede`（默认 `en-GB-Chirp3-HD-Charon`）、`--rate 0.95`、`--concurrency 3`。生成后把 `audio/` 目录提交并推送。段落文字被修改后，对应文件名（含文本哈希）不再匹配，会自动退回其他朗读方式，重新运行脚本即可补生成。费用和免费额度以 Google 官方定价为准；密钥需要在 Google Cloud 启用 Text-to-Speech API，并建议限制为只能调用该 API。

## 在线词典

网页直接通过 [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Parsing_wikitext) 查询英语和中文 Wiktionary 的英语词条，不需要账号、API 密钥或后端服务器。只发送所查词形，不发送正文或阅读历史。遵循接口限流，支持取消过期请求、超时提示和手动重试。查询过的在线词条在浏览器本地缓存最多 24 小时；“重新查询”可更新。

词典文本摘录并重新排版自 **Wiktionary 贡献者**，按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 使用，卡片内提供各条来源链接。多词源分别保留；词素按钮表示原词源中提及，不将所有关联词硬拼成构词公式。词典没有收录的词、专名或造词可能查不到；可打开完整 Wiktionary 或 Etymonline 补充查询。

前五页的中文阅读笔记仅作为“本书中文提示”保留，不充当在线词典结果。后续增加正文不会限制在线查词范围。

实现分为 `dictionary-parser.js`（提取词源与释义）、`dictionary-client.js`（联网与缓存）、`reader.js`（阅读交互）。接口只提取纯文本，不把外部 HTML 插入页面。相关规范：[跨域访问](https://www.mediawiki.org/wiki/API:Cross-site_requests)、[API 使用规范](https://www.mediawiki.org/wiki/API:Etiquette)、[Wiktionary 许可](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)。

中文为 AI 辅助译文，仅供对照阅读。英文依据 Lerner 2016 版的用户提供 PDF，按原 PDF 分页，保留跨页段落和诗歌换行。正文第 1 页对应 PDF 第 5 页，正文第 100 页对应 PDF 第 104 页。PDF 第 53 页起进入第二部。

译文逐段生成并核对覆盖范围，尚未经专业文学译者逐句审校；原作的双关、典故和方言可能有其他译法。仅渲染当前页，翻页与联网查词不随总页数增加而创建整本书的页面节点。

## 在线阅读

https://qiangwu769.github.io/ulysses-bilingual-reader/

## 部署

这是无需构建的静态网站。GitHub Pages 使用 `main` 分支根目录的 `index.html`。
