Spotify Rosetta v0.4.4
======================

Spotify Rosetta 是一个 Windows 自用 Spicetify Extension。它保留 Spotify
原生歌词、滚动和行高亮，只在歌词行下方追加互联网上已经存在的简体或繁体
中文译文，并可同时作用于右侧 Now Playing 歌词区和放大的完整歌词页。
Spotify 完全没有歌词时，它还可以用同一录音版本已经存在的原文或双语歌词
填充右侧 Now Playing 区域。

重要原则
--------

本软件不包含机器翻译、AI 翻译、LLM 或生成式补译。

程序只会查询以下来源已经公开提供的歌词/译文：

1. 网易云音乐的 lrc、tlyric 与可选 klyric 数据；
2. QQ 音乐的 orig 原文与 ts 译文；
3. Musixmatch 的 Richsync 原文与 crowd translation；
4. LyricsTranslate 同一页面中已经存在的人工中文译文，以及华语原曲的
   现成中文原文；
5. 已收录的公开网页中英/中日人工双语对照文章；
6. Spotify 原生歌词与 LRCLIB 仅用于原文；网易云 lrc 与 QQ 音乐 orig 只在
   Spotify 无原生歌词且没有现成译文时作为现成原文回退；
7. 用户按 Spotify Track ID 导入的本地现成 LRC 或 JSON 译文。

如果 Spotify 已有原生歌词但所有来源都没有现成中文译文，原生歌词不会被
替换，界面会显示“未找到可访问的现成中文翻译”。如果 Spotify 完全没有
原生歌词，而元数据严格匹配的平台条目只有原文，程序会显示该条目的现成
原文，不假装它是中文翻译。大陆曲库没有候选只表示网易云/QQ 音乐未收录，
不代表不存在人工译文。

功能
----

- 同时覆盖 Spotify 右侧歌词和放大歌词页，不创建独立悬浮歌词窗口。
- Spotify 没有原生歌词区或明确显示暂无歌词时，会在右侧 Now Playing 面板
  中创建双语回退面板；歌曲本身没有中文译文时显示同源现成原文。原生歌词
  存在时不会重复显示。
- Rosetta 歌词区固定在歌曲标题与艺人下方、“关于艺人”上方，避免被长艺人
  简介推到可视区域之外；歌词使用更接近 Spotify 原生歌词的大字号排版。
- Spotify 没有原生歌词但 Provider 找到了现成译文时，始终把该 Provider
  的外文原文与中文译文成对搬入 Now Playing，不会只显示外文原文。
- 原文和译文必须来自同一个 Provider，不会跨平台拼接歌词。
- 首选逐字同步，其次逐行同步，最后显示整段非同步译文。
- 来源带字级时间轴时，当前译文片段会随播放进度渐亮。
- 部分译文逐行显示，并标注覆盖率和来源。
- Spotify 没有原生歌词时，可将最佳第三方同源原文和译文放进原生区域，
  例如伍佰《挪威的森林》这类本身没有中文译文的华语原曲。
- 新歌首次播放时并行查询来源，先显示首个高置信结果，全部完成后无感升级。
- 结果按曲目缓存，最多 500 首，按最近使用淘汰。
- 手动搜索结果单独保存，可在设置中修改歌名、艺人和专辑后重新搜索。
- 手动候选绑定搜索当时的 Spotify Track ID；切歌后旧候选自动失效，不会写入
  新歌缓存。只有成功读取歌词的候选才显示可点击的“使用”按钮。
- LyricsTranslate 用于补充大陆曲库未收录但仍有人工翻译的歌曲。
- 对《最后一枪》这类大陆曲库缺少正确录音、但 LyricsTranslate 有公开原文
  的华语歌曲，网页来源可提供同源现成中文歌词，不借用其他歌手的同名版本。
- 网页双语 Provider 用于 LyricsTranslate 等结构化来源未覆盖、但公开文章中
  已经存在人工对照译文的歌曲。
- 支持导入双语 LRC、纯译文 LRC 和逐行 JSON，并按 Track ID 保存在本机。
- 不启用遥测，不上传 Spotify 账号信息或本地缓存。

环境要求
--------

- Windows 10/11 x64。
- Spotify 官方桌面安装版。Microsoft Store 版通常不能使用 Spicetify。
- Node.js 18 或更高版本，以及 npm。
- Spicetify。安装脚本会检测并在缺失时尝试安装。
- 本机已验证基础版本为 Spotify 1.3.6.1921。

安装
----

1. 先打开并登录 Spotify，确认标准桌面版工作正常。
2. 完全退出 Spotify。
3. 在项目目录打开 PowerShell。
4. 先预演：

   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -WhatIf

5. 正式安装：

   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -UseNpmMirror

如果 npm 官方源可正常访问，可去掉 -UseNpmMirror。

安装脚本会：

- 检查是否以管理员身份运行以及是否使用标准 Spotify；
- 安装/验证 Spicetify；
- 首次运行时执行 spicetify backup apply enable-devtools；
- 将 dist\spotify-rosetta.js 复制到 Spicetify 的 Extensions 目录；
- 执行 spicetify config extensions spotify-rosetta.js 和 spicetify apply；
- 默认重新打开 Spotify。

任何补丁操作执行前都会先显示 PowerShell ShouldProcess 确认。

使用
----

播放 Spotify 歌曲后，播放栏原生歌词按钮旁会出现 Rosetta 按钮。

- 左键：立即开启或关闭译文注入。
- 右键：打开设置、手动选源、来源状态、缓存管理和关于页面。
- 手动选定某个来源后，该选择会按 Spotify track ID 永久记忆。
- 清除全部缓存会同时删除自动结果和手动选择，操作需要再次点击确认。

译文显示规则
------------

- 逐字：来源提供字级时间轴时，译文片段随播放进度由暗到亮。
- 逐行：来源只提供行时间轴时，使用 Spotify 原生行高亮。
- 部分：只显示能够同源对齐的行，并标记覆盖百分比。
- 非同步：没有行时间轴时，把整段现成译文追加在歌词区域末尾。
- 原文：没有任何现成译文时，不修改已有 Spotify 原生歌词；Spotify 完全
  没有歌词时，可显示元数据和歌词序列校验通过的第三方现成原文。外语歌曲
  只要同一 Provider 存在现成中文译文，就同时显示外文原文和中文译文。
- 第三方回退：Spotify 显示“暂无歌词”或等价空状态，而第三方找到同源
  双语内容时，会在 Spotify 原生歌词容器内显示带来源标识的第三方歌词。
- Now Playing 回退：Spotify 连歌词容器都不创建时，在右侧面板的歌曲信息
  下方创建 Rosetta 歌词区，显示同源双语歌词或现成原文，并跟随播放进度
  高亮当前行。该区域始终位于“歌名/艺人”之后、“关于艺人”之前。

来源与匹配
----------

所有候选先经过 Unicode、空白、标点、标题、艺人、专辑、时长和版本词规范化。
明显不匹配的现场版、翻唱版、加速版和时长相差过大的版本会被拒绝。

曲目身份优先使用 Spotify ISRC 精确匹配；没有可用 ISRC 时，再按本地化标题、
艺人别名、专辑、时长和版本标签匹配。作为“译文”时，网易云条目必须实际包含
tlyric，QQ 音乐必须包含 ts，Musixmatch 必须包含 crowd translation。作为
Spotify 无歌词时的“原文回退”时，网易云 lrc 或 QQ 音乐 orig 可以让没有
中文译文的华语歌曲显示原文，但仍须通过同一套曲目身份门槛。抓取完成后还会
把 Provider 原文与 Spotify 原生歌词序列再对齐一次；原文内容不匹配的译文
结果会被丢弃，即使它的标题、艺人相同并且带有译文。

同一首歌的日语、韩语、英语、普通话或粤语录音版本会单独判断：程序从
Spotify 标题、专辑、语言元数据与原生歌词文字推断当前版本语言，并从
LyricsTranslate 搜索结果读取“Japanese → Chinese”等原语言。两边语言冲突
时拒绝候选；`English ver.`、`日本語版`、`韓文版`、`粵語版` 等标签也会作为
硬性版本条件，避免把另一个语言版本的译文挂到当前歌曲上。

最终排序依次使用：

1. 版本匹配置信度；
2. 译文覆盖率；
3. 时间轴精度（逐字 > 逐行 > 非同步）；
4. 来源优先（网易云 > QQ 音乐 > Musixmatch > LyricsTranslate > 网页双语）。

单个来源失败不会阻塞其他来源。遇到 429、5xx 或超时会启用短时退避和来源
冷却；切换歌曲会取消上一首歌的显示请求。

手动搜索
--------

右键 Rosetta 按钮，进入“手动选源”：

1. 可以修改歌名、艺人和专辑；
2. 点击“搜索现成歌词/译文”；
3. 候选列表会显示 Provider、匹配分、覆盖率和同步等级；
4. 点击“使用”后，该来源会覆盖当前曲目的自动选择并保存。

手动搜索页与当前歌曲绑定。若搜索后切换歌曲，页面会关闭或提示重新搜索；
不会把上一首歌曲的手动结果保存到新歌曲。

本地译文导入
------------

右键 Rosetta 按钮，进入“本地译文”：

1. 播放要处理的 Spotify 歌曲；
2. 粘贴双语 LRC、纯译文 LRC、逐行 JSON，或选择对应文件；
3. 也可以在来源栏填写人工译文网页 URL，点击“从网页链接提取”；
4. 可选填写人工译文来源名称或链接；
5. 点击“导入并应用”。

支持格式：

- 双语 LRC：原文和译文使用相同时间戳。
- 纯译文 LRC：优先按译文时间轴绑定 Spotify 原文。
- 逐行 JSON：包含 original、translation、startMs 字段。
- 无时间戳纯文本：只有与 Spotify 原文行数一致时才按顺序绑定。

导入内容只写入本机 IndexedDB，不上传。导入结果按 Spotify Track ID 记忆，
并优先于自动来源；之后手动选择的 Provider 仍可覆盖它。“清空缓存”会同时
删除自动结果、手动选择和本地导入。

隐私与版权
----------

- 本软件仅保存运行所需的歌词、译文、时间轴、Provider 和匹配元数据。
- 本地导入内容不会上传到 Spotify、歌词平台或本项目维护者。
- 不收集遥测，不接入分析服务，不上传 Spotify 凭据。
- 查询第三方歌词平台时会发送歌曲标题、艺人、专辑和时长。
- 缓存仅保留本机，不随项目分发。
- 项目不附带抓取到的歌词或译文。使用者自行承担第三方服务可用性和内容
  授权责任。请勿将歌词缓存作为内容库公开再分发。
- 网易云、QQ 音乐、Musixmatch、LyricsTranslate 等接口或页面可能属于
  非官方接口，可能随时限流、变更或失效；程序会显示失败原因并保留 Spotify
  原生歌词。
- 网页双语 Provider 只保存来源 URL，不把抓取到的歌词随项目分发。

开发与验证
----------

常用命令：

  npm install
  npm run typecheck
  npm test
  npm run build
  npm run dev

构建产物为单个文件：

  dist\spotify-rosetta.js

开发时修改代码后，将构建产物复制到 Spicetify Extensions 目录，再执行：

  spicetify apply

Spicetify 的 spicetify watch 主要监视主题文件，不负责扩展热重载；本项目使用
esbuild watch 重新生成扩展后再 apply。

Spotify 更新后
--------------

1. 完全退出 Spotify；
2. 如 Spicetify 本身过旧，先执行 spicetify update；
3. 重新执行：

   spicetify backup apply

4. 如果仍失败，执行：

   spicetify restore backup apply

仅移除 Rosetta
--------------

完全退出 Spotify 后运行：

  powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1

如需同时恢复 Spotify 原始客户端文件：

  powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -RestoreSpotify

也可以手动执行：

  spicetify config extensions spotify-rosetta.js-
  spicetify apply

完整恢复 Spicetify 前的 Spotify：

  spicetify restore

故障排查
--------

- 没看到 Rosetta 按钮：确认 Spotify 为普通桌面版，执行 spicetify apply 后
  完全重启 Spotify。
- 只有原文没有译文：先确认当前版本是否真的是外语歌曲；伍佰《挪威的森林》
  等华语原曲本来就没有中文译文。Spotify 无原生歌词时，程序会显示严格匹配
  的现成原文；Spotify 已有原文时，不会为了伪装成翻译而重复显示。
- 中文和原文错位：优先手动换源。程序不会用其他平台的译文强行补齐。
- Musixmatch 报验证码或 401：该来源会短暂冷却，其他来源不受影响。
- LyricsTranslate 找不到结果：会继续完成其他来源；冷门歌曲可在“本地译文”
  中导入已经存在的人工双语 LRC。
- QQ/网易云显示“大陆曲库未返回候选”：这是来源覆盖差异，不代表歌曲没有
  中文翻译，程序仍会查询 Musixmatch 和 LyricsTranslate。
- 网易云镜像不可用：程序会尝试公共搜索与歌词端点，并显示失败状态。
- Spotify 更新后失效：重新运行 spicetify backup apply；必要时执行
  spicetify restore backup apply。
- 手动搜索按钮显示“不可用”或没有候选：表示该来源没有返回可读取的歌词，
  或因网络/原生歌词缺失而加载失败；请换一个来源或点击“重新搜索”。
- 切歌后歌词没有立即更新：v0.4.4 会在一秒内轮询曲目并在切歌时关闭与旧歌
  绑定的手动选源页面；旧版缺少 Track ID 绑定的手动缓存会自动失效。

许可证
------

Spotify Rosetta 自有代码按 GPL-3.0-only 发布。完整许可证条款：
https://www.gnu.org/licenses/gpl-3.0.txt

现有平台与开源项目
==================

本项目在设计、协议验证和接口兼容过程中使用或参考了以下现有平台与开源项目：

1. Spotify（https://www.spotify.com/）：桌面客户端、播放 API 与原生歌词界面；
   Spotify 客户端和歌词内容受其自身条款约束。
2. Spicetify CLI（https://github.com/spicetify/cli）：本项目的运行、注入和
   回滚基础，LGPL-2.1；本项目不复制其 Spotify 内部界面代码。
3. Lyrics Plus（https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus）：
   网易云 Provider、Provider 排序和缓存行为参考，LGPL-2.1；仅作行为与接口
   参考，不复制其禁止脱离 Spotify/Spicetify 分发的代码。
4. ivLyrics（https://github.com/ivLis-Studio/ivLyrics）：右侧 Now Playing
   歌词注入、生命周期与 IndexedDB 行为参考，LGPL-2.1；本项目未以其源码为底
   修改，也未复制其界面代码。
5. Lyricify-Lyrics-Helper（https://github.com/WXRIW/Lyricify-Lyrics-Helper）：
   QQ 音乐 orig/ts、Musixmatch 翻译和歌词解析协议参考，Apache-2.0。
6. Lyricify-Lyrics-Helper-Swift
   （https://github.com/WXRIW/Lyricify-Lyrics-Helper-Swift）：QQ QRC
   Modified DES 算法与协议常量参考，Apache-2.0。
7. fflate（https://github.com/101arrowz/fflate）：QRC zlib 解压依赖，MIT。
8. expires0n/spicetify-lyrics-translate
   （https://github.com/expires0n/spicetify-lyrics-translate）：Spotify 原生
   歌词文本行注入与播放栏按钮思路参考；该仓库未提供许可证，本项目未复制其代码。
9. LRCLIB（https://lrclib.net/ / https://github.com/tranxuanthang/lrclib）：
   仅用于开放歌词原文回退，LRCLIB 服务与客户端源码的许可证以其仓库说明为准。
10. 网易云音乐（https://music.163.com/）：lrc、tlyric、klyric 现成歌词与
   译文来源；接口为非公开/第三方链路，内容版权归原权利人。
11. QQ 音乐（https://y.qq.com/）：orig、ts 与 QRC 现成歌词与译文来源；接口为非
   公开链路，内容版权归原权利人。
12. Musixmatch（https://www.musixmatch.com/）：Richsync 原文和 crowd
    translation 现成译文来源；接口与内容受 Musixmatch 条款约束。
13. esbuild（https://github.com/evanw/esbuild）、TypeScript
    （https://github.com/microsoft/TypeScript）、Vitest
    （https://github.com/vitest-dev/vitest）与 jsdom
    （https://github.com/jsdom/jsdom）：构建、类型检查和自动化测试工具，分别
    遵循其 MIT 或 Apache-2.0 许可证。
14. GD Studio Music API（https://music-api.gdstudio.xyz/）：网易云搜索与歌词
    的聚合回退服务；当前公开页面未声明开源许可证，本项目仅通过网络调用该
    服务，不复制或再分发其服务端代码，接口可用性与内容授权以其运营方为准。
15. LyricsTranslate（https://lyricstranslate.com/）：非大陆人工中文译文来源。
    本项目只读取公开搜索页和译文页中已经存在的原文与译文，保留来源链接，
    不生成补译；站点内容受其自身条款和译者/版权权利人约束。
16. Navidrome LyricsTranslate Plugin
    （https://github.com/Myzel394/navidrome-lyricstranslate-plugin）：
    LyricsTranslate 搜索页、双语正文和 WebVTT 字幕结构参考，MIT；本项目使用
    独立的 TypeScript 实现，不复制其运行时或打包产物。
17. 蔚藍天空 · PIXNET
    （https://tonyliu0936.pixnet.net/blog/posts/14217066080）：
    We Didn't Start the Fire 人工中英对照译文来源；文章与译文权利归原作者，
    本项目仅保存 URL 并在本机运行时读取，不随项目再分发正文。
18. abesanets/spicetify-sidebar-lyrics
    （https://github.com/abesanets/spicetify-sidebar-lyrics）：Spotify Now
    Playing 面板中创建独立歌词区域的思路参考；该仓库未声明 LICENSE，本项目
    仅参考公开行为与 DOM 生命周期，不复制其源码。

