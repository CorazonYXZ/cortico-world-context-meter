# 安全与隐私 / Security and privacy

## 当前状态：源码预览，依赖整改尚未完成

2026-10-29 对 v0.5.1 源码、构建文件和本机生成的安装包进行了检查。未发现扩展主动窃取、遥测或上传数据的逻辑；当次包内 61 个文件未命中本机个人标识和常见密钥特征。既有 122 项测试通过。**这些结果不等于零漏洞、正式安全认证或所有环境均兼容。**

本次只公开 GitHub 源码，不发布 npm、不申请市场同步或官方认证。

## 已知依赖问题

| 范围 | 当次检查结果 | 说明 |
|---|---|---|
| 生产依赖 | 0 严重、0 高危、1 中危、0 低危 | ExcelJS → uuid 8.3.2；当前检查到的调用使用 v4，未发现受影响接口的触发路径，但仍需评估处理。 |
| 全部依赖，包含开发环境 | 3 严重、1 高危、11 中危、1 低危 | 已包含上一行；不要再相加。主要来自 Vitest、Tinypool、Vite 等测试／开发工具及关联链路。 |
| 许可资料 | buffers 0.1.1：Unknown | 不在当前使用的 ExcelJS 浏览器代码中，但仍在安装依赖链，许可需核实或清理。 |

重点公告：

- [UUID 缓冲区边界问题](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)：影响 v3／v5／v6 接口的特定用法，不是本扩展已泄露数据的证据。ExcelJS 的浏览器发行版含预打包代码，只覆盖外部 uuid 版本不能自动替换其中内容。
- [Vitest UI／API 文件读取与执行](https://github.com/advisories/GHSA-5xrq-8626-4rwp)：当前脚本为 `vitest run`，没有启用 UI／API，但旧版开发工具链仍需升级。
- [Tinypool Worker 选项问题](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[Tinypool run 选项问题](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)：存在原型污染等触发前提，涉及开发机／CI；不能忽略严重告警，也不能仅凭命中版本认定已经被利用。
- [Vite／launch-editor Windows 路径处理](https://github.com/advisories/GHSA-587h-7wmj-h5pm)：涉及受影响开发服务及编辑器入口；不要将旧开发服务对外开放。

整改前不建议把此版本作为已完成安全验收的正式发行版。后续需要选用兼容的修复版本／替代分发文件，更新锁文件和许可记录，并重新验证生产与开发依赖、构建、测试、导出和宿主安装。本次源码提交未声称完成这些整改。

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

This is a source preview, not an npm release or security certification. The 2026-10-29 review found no active data exfiltration in the inspected extension code or local tarball, but production/development dependency advisories and one unclear transitive license remain open. The complete dependency audit reported 3 critical, 1 high, 11 moderate and 1 low package/advisory records; the production-only audit reported one moderate record. Exploit prerequisites matter; an advisory is not evidence that this extension has been exploited.

Observation is off by default. When enabled, new host records may temporarily contain chat and sensitive tool results; bodies are processed locally and not retained or uploaded. History and exports contain usage metadata, are not fully anonymous, and local history is plaintext. Expiry cleanup runs on save/access; stopping/uninstalling is not a timed-erasure guarantee. Review files before sharing and never post secrets or real conversation logs in public issues.
