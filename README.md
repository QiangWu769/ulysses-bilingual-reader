# 尤利西斯 · 中英对照阅读

James Joyce《Ulysses》正文前 100 页的中英对照阅读网页，对应提供的 PDF 第 5–104 页。

- 手机横屏时，左侧英文、右侧中文，逐段对照。
- 支持翻页、页码选择与字号调整。
- 竖屏时按段落上下排列。
- 长按英文单词约半秒，直接加载在线词义、构词与词源；电脑可直接点击。
- 顶部“查词”支持任意英文单词、前缀与后缀（例如 `unbelievable`、`un-`、`-able`），查询范围不受已加载正文限制。
- 词源中提到的英语词素与词典明确标注的原形可以继续点查，并可返回上一个词。
- 词义与词源分栏展示。中文未收录时显示英文原文；没有词源时明确提示，不自动猜测拆词。

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
