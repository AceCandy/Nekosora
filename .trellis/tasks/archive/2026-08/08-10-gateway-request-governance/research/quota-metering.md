# 配额计量边界调研

## 当前用量事实

- `packages/db/src/schema.ts:932` 的 `gateway_executions` / `gateway_attempts` 记录 token、状态、延迟和路由事实，但没有费用、配额周期、预留或媒体用量字段。
- `packages/core/src/lib/gateway-execution/telemetry.ts:10` 在执行开始时写 running，最终才把 adapter 返回的 usage 写入 execution。失败和中断可能没有 usage。
- Chat 可以获得 input/output/reasoning/cache token，但兼容上游可能不返回流式 usage；不能把缺失值无条件当作零成本。
- `packages/core/src/lib/providers/multimodal/image-gen.ts:43` 明确说明图像生成没有 token usage，天然计量单位是图片张数及规格。
- TTS 当前只有输入文本和输出音频；适配器不返回字符、时长或供应商 usage。可稳定预先计算的单位是输入字符数。
- STT 当前只有上传字节、MIME 与转写文本，没有可靠音频时长。文件字节数不能等价为供应商计费分钟数。

## 必要语义

- 硬配额要在 Provider 调用前原子预留，完成后按实际用量结算；失败释放预留，重复 finalize 必须幂等。
- 流中断但已产生可计费用量时不能简单全额退款；上游缺失 usage 时必须采用明确的保守策略，不能默认为零。
- 不同模态不能伪装成统一 token。若要在本任务内覆盖全部模态，必须先定义 image count、TTS chars、STT duration 等独立单位及其周期和默认额度。

## 已确认范围

- 所有受保护入口启用请求速率限制；Provider/RAG 工作启用并发租约。
- Chat 按 token、Image 按图片张数、TTS 按输入字符数、STT 按音频时长建立独立的预留、结算和退款能力。
- 媒体配额必须在本任务内完成，不能只做速率与并发保护。
- 配额周期使用 PostgreSQL UTC 日历月，`Retry-After` 指向周期重置时间。

## 计量口径

- Chat 预留使用现有 `packages/core/src/lib/tokens.ts:25-52` 的消息估算值，加客户端显式 `max_tokens`；客户端未给上限时使用模型目录中的 `maxOutputTokens`。结算优先采用上游 `totalTokens`，否则采用 `inputTokens + outputTokens`；reasoning/cache 字段视为明细，不能再次相加。缺失或无效 usage 时按预留值保守结算，不能按零退款。
- Image 的 `n` 必须先校验为 1-10 的整数，再按 `n` 预留；成功后按 `result.images.length` 结算并退还差额。`size` 与 `response_format` 不影响张数 reservation，保持当前兼容行为。
- TTS 按 Unicode code point 计数，即 `Array.from(input).length`，并让现有 4096 输入上限与配额共用同一计数函数。`response_format` 不影响输入单位，保持当前兼容行为。
- STT 使用维护中的纯 ESM `music-metadata@11.14.0` 在 Provider 调用前解析内存中的音频，要求有限且大于 0 的 duration，并按整秒向上取整。损坏、无音轨、容器不支持或无法取得可靠时长时拒绝请求；不引入 `ffprobe` 系统依赖，也不按 MIME 声明或文件字节猜测时长。
- 请求前无法形成可靠 reservation 时拒绝且不得触网；请求在首个 Provider attempt 标记前失败时全额退款。一旦进入 Provider attempt，缺少实际 usage 的失败、中断或进程异常按预留值保守结算；已取得实际结果时只结算实际值，终态重复写入必须无副作用。

## 依赖依据

- 当前仓库没有音频时长解析依赖或 `ffmpeg` 运行时前置条件。
- `music-metadata@11.14.0` 支持 Node 18+，提供 `parseBuffer(buffer, { mimeType }, { duration: true })`，覆盖 MP3、MP4/M4A、AAC、FLAC、Ogg/Opus、WAV、AIFF、Matroska/WebM 等常见格式。当前 STT 请求已经把最多 25 MiB 文件读入内存，完整扫描不会新增第二份持久化文件。

## 验证重点

- Chat 上游完整、部分和完全缺失 usage；流完成、取消、失败与工具协议降级。
- Image 实际返回少于预留、等于预留以及违反适配器契约多于预留的情况。
- TTS ASCII、中文、emoji、组合字符边界以及 4096/4097 code point。
- STT 支持格式、伪造 MIME、损坏文件、无音轨、零时长、VBR/Ogg 完整扫描和秒数取整。
