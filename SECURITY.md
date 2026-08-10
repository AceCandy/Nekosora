# 安全策略

我们非常重视 Nekusora 的安全性。本文档说明如何报告漏洞及我们的响应流程。

## 🔒 报告漏洞

**请勿在公开 GitHub Issue 中报告安全漏洞。**

请通过以下方式私密披露:
- 邮件:发送至仓库 owner 的邮箱(见 GitHub profile),主题加 `[SECURITY]` 前缀
- GitHub Security Advisory:使用 [私密漏洞报告](https://github.com/AceCandy/Nekosora/security/advisories/new)(推荐)

报告时请包含:
1. 漏洞类型(如 SQL 注入、XSS、鉴权绕过、SSRF)
2. 复现步骤(最小化 PoC)
3. 影响范围(哪些端点/数据可被影响)
4. 建议的修复方向(可选)

## ⏱️ 响应时间线

| 阶段 | 时间 | 说明 |
|---|---|---|
| 确认收到 | 48 小时内 | 我们会确认收到并初步评估 |
| 初步评估 | 7 天内 | 给出严重程度评级与修复计划 |
| 修复发布 | 30 天内(严重漏洞优先) | 发布修复版本并致谢 |

## 🎯 支持版本

安全修复只针对最新的 `main` 分支与最近的 release tag。旧版本不提供 backport。

## 🛡️ 安全设计要点

Nekusora 的关键安全机制(供审计参考):
- **API Key**:BCrypt 哈希存储,仅比对哈希;明文 key 仅在创建时返回一次
- **文件访问**:属主校验(userId === 当前用户),非公开
- **注入防护**:API key 用户提交的 system prompt 等以 system message 注入,有边界标记
- **XSS 防护**:用户消息纯文本渲染;默认及流式 assistant 内容由 Streamdown(rehype-harden)加固
- **Artifact 隔离**:模型生成的 HTML/SVG 在不含 `allow-same-origin` 的 sandbox iframe 中预览,不提供脱离 sandbox 的顶层执行入口;复制与下载仍是用户主动操作
- **CORS**:`/v1/*` 网关端点允许跨域;管理端点同源

### 管理员受信的 custom renderer

管理员启用 custom 输出样式后,静态 assistant 内容中的 HTML/class/style 会原样进入聊天页和公开分享页,不属于 Streamdown 的净化边界。该能力用于模型与内容来源可控的部署,管理员应在启用前确认其信任范围;管理界面的提醒不构成技术隔离。

## 🚫 不在范围内的报告

以下情况不视为安全漏洞:
- 未启用 HTTPS 的自部署(部署者责任)
- 用户主动配置的弱密钥/明文环境变量
- 对未鉴权端点的速率限制缺失(非数据泄露)
- 第三方上游模型的行为(联系对应厂商)

感谢你帮助 Nekusora 更安全。
