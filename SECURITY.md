# 安全与隐私 / Security and privacy

## 当前状态：v0.5.2 已处理本轮已知告警

2026-10-29 对 v0.5.2 完成生产、完整开发依赖及实际 Excel 线程构建输入检查。当次生产依赖 1 个、全量依赖 391 个，已知漏洞查询均为 0；74 个实际随 Excel 线程打包的依赖连同运行时分词库共 75 个包均已记录许可和来源。既有 122 项测试通过。**这些结果不等于零风险、正式安全认证或所有环境均兼容。**

可复核记录：[当次安全检查](provenance/security-check.json)、[Excel 构建输入及校验](provenance/excel-bundle.json)、[运行时与打包依赖许可](provenance/production-dependencies.json)。开发者运行 `pnpm build`、`node scripts/licenses.mjs`、`pnpm check:security` 可重新检查；查询只发送公开依赖名称和版本。

源码与发行包使用相同的统计与隐私边界。npm 发布和市场收录不代表官方认证或安全背书；本项目仍标记为实验性扩展。

## 上轮问题及本次处理

| 范围 | v0.5.1 旧检查结果 | v0.5.2 处理 |
|---|---|---|
| 生产依赖 | 1 中危 | 从官方 Node 入口重建 Excel 线程，实际打包 uuid 11.1.1；ExcelJS 转为构建依赖，不再加载旧浏览器分发包。 |
| 全部依赖，包含开发环境 | 3 严重、1 高危、11 中危、1 低危 | 固定 Vitest 5.0.5、Vite 8.3.5，移除旧 Tinypool 链路；当次全量查询为 0。 |
| 许可资料 | buffers 0.1.1：Unknown | 更新 unzipper 至 0.12.5，移除 binary／buffers，依赖树及实际打包输入均已核对。 |

重点公告：

- [UUID 缓冲区边界问题](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)：影响 v3／v5／v6 接口的特定用法；本次替换实际运行代码，而非仅隐藏依赖告警。
- [Vitest UI／API 文件读取与执行](https://github.com/advisories/GHSA-5xrq-8626-4rwp)、[Tinypool Worker 选项问题](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[Tinypool run 选项问题](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)、[Vite／launch-editor Windows 路径处理](https://github.com/advisories/GHSA-587h-7wmj-h5pm)：通过工具链升级处理，仍只运行批量测试，不开启 UI／API 开发服务。

安装时仍可能看到少量上游的弃用提示（如 glob、inflight、lodash.isequal、whatwg-encoding）；它们不等同于本次漏洞数据库命中的告警，本次没有通过忽略告警来通过检查。后续仍应关注上游维护状态和新公告。

升级的 unzipper 含可选 S3 读取入口，构建时明确替换为禁止访问的本地实现，不安装 AWS SDK、不新增云服务能力。Excel 线程只接收白名单统计，在内存生成文件，外部导入仅限 Node 内置模块。采集、历史格式、数据保留与分享边界不变。

## 会读取什么

- 静态排行读取框架指定扩展目录的清单、直接安装扩展的包清单及指定自描述；不导入其他扩展入口，不把提示词正文返回页面。
- 动态观察默认关闭。用户开始后，只增量读取宿主 `usage.jsonl`、运行索引及经校验的当前运行工具／会话流水；可能临时接触聊天或敏感工具结果，正文仅在本机内存处理，不进入页面、历史、导出或正文日志。
- 不额外打开源 Markdown、图片、密钥配置，不重抓网页，不调用模型，不运行 FFmpeg，不上传统计。安装依赖时的 registry 网络与运行时数据外传应区分。

## 会保存什么

- 历史和手动导出仅含白名单统计：时间、模型、工具／World 名称、token、次数、耗时、覆盖状态、关联标识及自定义历史名称。请求／响应／调用标识经散列，但不能承诺完全匿名或无法关联。
- 本机历史是明文 JSON，依赖系统目录权限保护，没有另外的内容加密。自定义名称和模型／扩展名称也可能包含用户自行填写的信息。
- 历史默认 7 天、最多 30 次／64 MiB；过期清理在保存／访问历史时执行。关闭或卸载后没有独立的定时销毁服务。
- 清空当前结果保留历史；删除历史不删除此前下载的 JSON／Excel。需要清理时，应同时检查历史列表和自己的下载文件。
- 导出文件分享前请审阅。不要将它当作“没有任何隐私信息”的匿名文件直接公开。

## 反馈问题

请在 [Issues](https://github.com/CorazonYXZ/cortico-world-context-meter/issues) 提供版本、操作步骤、错误码和不含隐私的现象。**不要公开 API Key、密码、认证头、真实聊天、完整运行日志、个人文件路径或未审阅的统计导出。** 对可能被利用的问题，先给出不含攻击细节或敏感数据的简要说明，再与维护者安排后续沟通。

## English

This experimental extension is not officially certified. Publishing to npm or inclusion in the market is not a security endorsement. Version 0.5.2 rebuilds the Excel worker from the official Node entry with uuid 11.1.1, updates unzipper to 0.12.5 to remove binary/buffers, and upgrades Vitest/Vite to 5.0.5/8.3.5. The 2026-10-29 production and full dependency audits report zero known advisories; actual bundle inputs and license texts are also checked. This is a dated database result, not a zero-risk guarantee. Optional cloud access is disabled; no AWS SDK is added. Upstream deprecation notices may remain.

Observation is off by default. When enabled, new host records may temporarily contain chat and sensitive tool results; bodies are processed locally and not retained or uploaded. History and exports contain usage metadata, are not fully anonymous, and local history is plaintext. Expiry cleanup runs on save/access; stopping/uninstalling is not a timed-erasure guarantee. Review files before sharing and never post secrets or real conversation logs in public issues.
