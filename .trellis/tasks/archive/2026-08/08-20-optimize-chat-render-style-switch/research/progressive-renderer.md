# 超长会话渐进 renderer 切换

## 已确认事实

- 默认样式是隐式 `streamdown`；内置「纸面杂志」是 `custom`。
- 两者切换会让全部历史 assistant Markdown 更换渲染树；`useDeferredValue` 只保证控件优先响应，不减少总 DOM 重建量。
- 合成基准中 Markdown 分段、解析和规范化耗时不足以解释肉眼可见延迟，单独增加解析缓存收益有限。
- `MessageScroller` 已通过 `useMessageScrollerVisibility()` 暴露 `visibleMessageIds`，值对应现有 `msg-{index}`，无需新增 `IntersectionObserver`。
- visibility hook 必须在 `MessageScroller.Provider` 后代调用；`ChatMessageList` 函数本身位于 Provider 外，不能直接调用。

## 推荐边界（需产品确认）

在 Provider 内增加最小的渐进渲染层：

1. 选择状态与祖先 `rs-*` CSS scope 立即更新。
2. 当前可视 assistant 消息优先切换 renderer。
3. 屏幕外 assistant 消息按小批次让出主线程后继续切换。
4. 每次选择生成新的切换代次；新的选择取消旧代次，最终全部消息收敛到最新 renderer。
5. 初次打开已有会话仍直接使用会话保存的 renderer，不制造加载后的二次换肤。

该方案不改变 MessageScroller、滚动记忆、消息 DOM 数量、会话持久化和最终渲染结果。唯一可见差异是切换期间屏幕外历史消息可能短暂保留上一个 renderer。

## 不采用

- 不把纸面杂志改为 `streamdown`：其 CSS 明确依赖 custom 保留的高级 HTML/class，行为会退化。
- 不做消息虚拟化：违反现有滚动、锚点与流式跟随契约。
- 不先上 `content-visibility`：估算高度可能影响 `scrollHeight` 与滚动记忆。
- 不单独做 parser/LRU 缓存：当前测量表明它不是主要瓶颈，且会增加内存与失效管理。

## 最小验证

- 可视 assistant 在第一批获得目标 renderer，user 始终不接收 renderer props。
- 屏幕外 assistant 分批收敛，完成后全部使用目标 renderer。
- 连续快速切换时旧批次失效，不覆盖最新选择。
- 初次加载、流式消息、CSS scope、paper 代码块语义和现有滚动测试保持不变。
