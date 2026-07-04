# Chat TTS 朗读

## Goal

接通当前永久 disabled 的「朗读」按钮，用浏览器原生 SpeechSynthesis 实现消息语音播放，零后端、零费用。

## Requirements

- 点击 assistant 消息底部「朗读」按钮，朗读该条消息正文（纯文本，剥离 Markdown 符号与代码块）
- 朗读中按钮变为「停止」态，可中途停止
- 朗读结束/取消后按钮恢复初始态
- 流式消息：未完成时不触发朗读（或明确提示「等生成完再朗读」）—— design 阶段确认策略
- 语音选择：默认跟随系统语言，提供常用语音下拉（仅列出浏览器可用语音）
- 浏览器不支持 SpeechSynthesis 时，按钮保持 disabled 并给 tooltip 说明
- 多条消息同时只能朗读一条：新朗读自动停止旧朗读

## Acceptance Criteria

- [ ] 支持的浏览器中点击「朗读」能听到声音
- [ ] 朗读中点击可停止
- [ ] 切换到另一条消息朗读时，前一条自动停止
- [ ] 不支持 SpeechSynthesis 的环境按钮 disabled 且有说明
- [ ] 流式生成中朗读按钮行为符合 design 决策
- [ ] 暗色模式与移动端正常

## Constraints

- 仅用浏览器 `window.speechSynthesis`，不接后端 TTS provider
- 朗读文本需先做清洗：去代码块围栏、去 Markdown 语法符号、去 HTML artifact 标记
- voices 异步加载（`onvoiceschanged`）需处理
- 文案 i18n，复用现有「朗读」翻译 key

## Notes

- 参考 AMC-WebUI `controls/VoiceControl.tsx`（但那是后端 TTS，本任务只用原生 API，仅借鉴 UI 与状态机）
- 本任务 PRD-only 即可
