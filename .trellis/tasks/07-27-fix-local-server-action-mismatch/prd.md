# 修复本地开发 Server Action 清单失配

## Goal

恢复本地 Next.js 开发环境中聊天分享操作的 Server Action 一致性，使当前页面只提交当前服务端 manifest 可识别的 Action ID，并确认问题是否仅由旧浏览器状态或 `.next` 开发缓存造成。

## Background

- 控制台报错请求的 Action ID 为 `40d872214be3f380b7792606683590d49ca70e6962`，当前 `.next/server/server-reference-manifest.json` 与 standalone manifest 均不包含该 ID。
- 当前 manifest 中对应 [src/app/chat/[id]/page.tsx:89](/vol1/1000/ssd/workai/Nekosora/src/app/chat/[id]/page.tsx:89) `handleCreateShare` 的 ID 为 `60d872214be3f380b7792606683590d49ca70e6962`。
- Next.js 将 Action 使用的参数位编码在 ID 首字节中：`40...` 表示仅使用第 1 个参数，`60...` 表示使用第 1、2 个参数。
- 提交 `ae76b73` 将 `handleCreateShare` 从单参数改为双参数，与上述 ID 变化一致。
- 用户确认故障发生在本地开发环境，不需要在本任务中处理生产多副本或滚动发布。
- 清理 Action 缓存后，分享 Action 已成功返回，但局域网 HTTP 环境没有 `navigator.clipboard`，`ChatHeader` 直接调用 `writeText` 导致运行时错误。

## Requirements

- 先停止项目的本地开发服务，再以可回滚方式隔离现有 `.next` 产物，避免混用旧 Action manifest。
- 从干净开发产物启动应用，并通过新的浏览器页面验证聊天分享请求使用当前 Action ID。
- 若干净启动与硬刷新后错误消失，不修改业务源码；若仍复现，必须取得新的请求与 manifest 证据后再做最小源码修复。
- 分享链接复制必须复用现有 `copyToClipboard`，在 Clipboard API 缺失或被拒绝时使用项目既有回退逻辑，且仅在复制成功后展示完成状态。
- 调试结束前关闭本任务启动的服务，并清理本任务产生的临时产物。
- 保留用户当前未提交的 Trellis 0.6.9 更新改动，不回退或混入无关修改。

## Acceptance Criteria

- [x] 干净启动后的 manifest 包含当前双参数分享 Action，且不再由新页面提交旧 `40d872...` ID。
- [x] 在聊天详情页触发分享时，控制台和服务端不再出现该 `UnrecognizedActionError`。
- [x] 分享成功行为保持不变：仍按当前可见消息版本生成分享结果。
- [x] `navigator.clipboard` 不可用时，分享链接复制不再读取 undefined 的 `writeText`，并通过回退路径完成复制。
- [x] 若未修改业务源码，明确记录环境恢复步骤；若修改源码，相关定向检查通过。
- [x] 调试服务已关闭，工作树中没有本任务产生的缓存、日志或临时调试文件。

## Out of Scope

- 生产环境的 deployment ID、CDN、负载均衡、粘性会话或滚动发布策略。
- 重构现有分享业务、改变分享数据模型或用户界面。
- 升级 Next.js、Trellis 或其他依赖。

## Technical Notes

- 当前 `python3` 为 3.11.2，而更新后的 Trellis 0.6.9 脚本使用 Python 3.12 语法；本任务的 Trellis 命令使用已安装的 `python3.12`，不修改 Trellis 脚本。
- 本任务按轻量故障处理，规划阶段仅需要本 PRD；若干净环境仍稳定复现并需要跨层修改，再补充技术设计与实施计划。
- 环境恢复步骤：停止本仓库原有 `pnpm dev` 进程，以临时目录备份旧 `.next`，从空缓存重新启动开发服务并请求聊天详情路由，验证后关闭浏览器与服务并删除旧缓存备份。
- 干净开发 manifest 为 `src/app/chat/[id]/page.tsx` 生成了双参数 Action ID `60071050df039fda7e172067bcb4cbdc9fffb44ec2`；旧 `40d872...` 不存在。该 ID 属于开发构建产物，后续构建可再次变化。
- 浏览器访问聊天详情路由后因无已登录会话跳转到 `/login`；控制台和服务端日志均未出现 `UnrecognizedActionError`，但无法在不读取凭据或创建测试用户的前提下完成分享点击与结果验证。
- 用户在已登录页面触发分享后，Server Action 已成功返回并进入链接复制阶段，确认 Action 清单失配已消除；随后暴露出局域网 HTTP 下 Clipboard API 缺失的问题。
- `ChatHeader` 已改为复用 `copyToClipboard`，仅在复制成功时显示完成状态。新增测试覆盖 Clipboard API 缺失时的 textarea 回退；lint、类型检查、12 条分享/剪贴板定向测试及完整 754 条 Vitest（742 通过、12 跳过）均通过。
