# AGENTS.md

NKC 附件存储服务。按「上传时间 → 磁盘区间」把文件落到多块盘上，对外只提供读写、信息查询与真实路径解析，**不做任何转码或图片处理**（那些在 `nkc-media`）。

## 技术栈

- **纯 JavaScript + CommonJS，没有构建、没有 TypeScript、没有测试、没有 lint 脚本**
- Koa 2 + koa-router + koa-body（formidable 接收 multipart）
- 依赖安装用 **yarn**（锁文件 `yarn.lock`；README 里写的 `npm i` 是历史遗留）
- 默认端口 10292

## 目录结构

```
server.js               # 入口：建 temp、解析 CLI 参数、koaBody、中间件、listen
routes.js               # 路由表（7 条，见下）
router/                 # 每个路由一个文件，只做参数整理
├── get.js              # GET  /            取文件（设置 ctx.filePath）
├── store.js            # POST /            存文件
├── info.js             # GET  /info        文件信息（含是否丢失）
├── list.js             # GET  /list        按年月列出
├── metaInformation.js  # POST /metaInfo    元信息
├── getStorePath.js     # POST /storePath   真实磁盘路径
└── removeInfo.js       # PUT  /removeInfo  清除元信息
middlewares/
├── init.js             # ctx.data = {}；把 body + query 合进 ctx.body
├── error.js            # 统一错误出口 {status, message}
└── body.js             # 统一响应出口：有 ctx.filePath 走文件流，否则输出 ctx.data
tools.js                # 时间→磁盘映射、文件信息、Range 解析、元信息读写
path/                   # 本机落盘目录（见下）
temp/                   # multipart 上传临时目录（gitignored，不存在时自动创建）
```

## 请求处理流程（本仓库最独特的一点）

```
koaBody → error → init → router → body
```

- `init` 把 `ctx.data` 清空，并把请求体 / query 合进 `ctx.body`。
- **路由只往 `ctx.data` 写数据**，或者设置 `ctx.filePath` 表示"要回文件"。
- 最后的 `body` 中间件统一出响应：有 `ctx.filePath` 就按文件流返回（带 ETag、Cache-Control、`Accept-Ranges`、206 分段、`Content-Disposition: attachment`），否则把 `ctx.data` 当 JSON 返回。

所以：**路由里直接写 `ctx.body = ...` 是无效的**，会被 `body` 中间件覆盖。要返回数据就写 `ctx.data.xxx`。

## 路由与约定

| 方法与路径 | 入参 | 说明 |
| --- | --- | --- |
| `GET /` | query `time`、`path` | 返回文件流，支持 Range / 断点续传 |
| `POST /` | multipart `files` + `fields.filesInfo` | `filesInfo` 是 `{ 字段名: {time, path} }`，按字段名把临时文件搬到目标盘 |
| `GET /info` | query `files`（JSON 字符串） | 逐个返回 `{type, time, path, lost, info}` |
| `GET /list` | query `year`、`month` | 列出该月已落盘文件；年月非法直接 400 |
| `POST /metaInfo` | body `files[]` | 读文件元信息（宽高 / 时长 / md5 等） |
| `POST /storePath` | body `files[]` | 返回 `storePath`（真实磁盘路径） |
| `PUT /removeInfo` | query `files`（JSON 字符串） | 清除元信息（写临时副本 → rename 覆盖） |

`time` 一律是**毫秒时间戳**，`path` 是相对目录，两者共同决定文件落在哪块盘的哪个位置。

## 时间分区（最容易出错的地方）

`configs.json` 的 `attachment` 是一个按时间划分的磁盘列表，**前闭后开**：

```json
{ "startingTime": "1970-01-01", "endTime": "2020-07-14", "path": "E:/nkc-resource1" }
```

`tools.getDiskPath(time)` 顺序遍历取第一个命中的区间；**一个都不命中就抛 `未找到匹配的文件目录`**（读写都会因此 500）。

- 加盘 / 迁盘时：区间不能重叠（先命中先赢），也不能留缝（留缝等于那段时间的文件读写全部失败）。
- 时间边界按 `new Date('<startingTime> 00:00:00')` 解析，写日期时用 `YYYY-MM-DD`，不要带时区。
- 改区间会影响**已有文件的可读性**——旧文件的 `time` 必须仍能命中它所在的盘。

## 配置

`configs.json`（**被 .gitignore 忽略，不要提交、不要把内容贴进对话**），模板见 `configs.template.json`：

| 配置 | 说明 |
| --- | --- |
| `port` | 监听端口，可被 `--port` 覆盖（默认 10292） |
| `attachment` | 时间分区 → 磁盘根目录列表 |

- `attachment` 为空时服务启动即抛 `未指定文件目录`。
- `--host` / `--port` 命令行参数优先级高于配置文件。
- README 里的配置示例写的是 `store.json`、接口表写的是 `POST /getStorePath`，**两处都与当前代码不符**：实际读 `configs.json`，实际路由是 `POST /storePath`。以 `server.js` 和 `routes.js` 为准。

## `path/` 目录

按业务场景预置的落盘目录结构：

- `attachment/`：`cover`、`userAvatarAudit`、`userBannerAudit`、`userHomeBannerAudit`
- `message/`：`image`、`video`
- `resource/`：`picture`、`video`、`attachment`、`origin`

它**不在版本控制里，可能含真实的用户上传文件**（本机已有 `2026/11` 的样例）。不要提交、不要删除、不要当成"可清理的临时目录"；排查文件丢失时，它可以作为对照。

## 规范

- 纯 CommonJS，新增文件不要写 TypeScript（本仓库没有编译步骤）。
- 大文件必须流式：读用 `fs.createReadStream` + 现有 Range 逻辑，写用 formidable 的临时文件 + `tools.moveFile`。不要退化成 `readFile` / `writeFileSync`。
- `tools.moveFile` 是 `mkdir → copyFile → deleteFile`，**跨磁盘安全**；不要改成 `fs.rename`（跨盘会 EXDEV 失败）。
- 错误用 `ctx.throw(status, msg)` 或 `new Error`，由 `middlewares/error.js` 统一输出 `{status, message}`；不要自己 `ctx.status/ctx.body` 拼错误响应。
- 文件名、扩展名解析走 `tools` 里已有实现，不要在路由里重复写。
- 中文注释；提交信息用 Conventional Commits 前缀 + 中文描述。
- `server.js` 里有一处历史 `// todo: 修复路径 1`，改动该区域时顺手确认路径拼接是否正确。

## 运行与验证

```bash
yarn install
# 复制 configs.template.json 为 configs.json，填好本机磁盘路径
yarn start                                  # 或 node server.js --host 127.0.0.1 --port 10293
```

**没有测试、没有 lint**。改完靠静态检查 + 手动打一次 `GET /info`（用已知存在的 `time`/`path`）验证读写链路；不要为此引入测试框架。
