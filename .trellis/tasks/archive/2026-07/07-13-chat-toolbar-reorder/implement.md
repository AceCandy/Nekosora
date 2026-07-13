# Implement — 工具栏顺序调整

## 改动文件

`src/features/chat/components/ChatToolbar.tsx`（仅 `ChatToolbar` 函数 `return` 内的 JSX 块顺序）

## 步骤

- [ ] 在 `ChatToolbar` 的 `return` 中，按目标顺序重排 8 个控件块（见 prd 目标顺序列表）。
- [ ] 推理强度 `<ReasoningPicker ... />` 从末尾移到模型 `<OptionPicker .../>`（模型选择）之后。
- [ ] 指令卡块从模型之后移到联网之后。
- [ ] 模型参数 `<ModelParamsPicker ... />` 移到知识库之后、输出模式之前。
- [ ] 不动：模型选择块内部、各块内部代码、chip 行。
- verify: `pnpm typecheck`；手动：新会话页与历史会话页工具栏顺序正确。

## 注意

- `ReasoningPicker` / `ModelParamsPicker` 是同文件内定义的局部组件，移动 JSX 调用位置即可，不需要改 import。
- 保持各块之间无多余空行差异（match 现有风格）。
