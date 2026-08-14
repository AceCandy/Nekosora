# Chat 侧栏交互与研究状态修复设计

## 1. Boundaries

- `conversations` Server Actions 负责属主隔离、分组摘要、分组键集分页、当前会话补入及既有重命名/置顶/归档操作；Client 不自行推导服务端总数。
- `Sidebar` 负责浏览器本地时间边界、每组独立请求状态、折叠状态、重排后的当前项定位、菜单与离线反馈；不引入全局服务端状态缓存。
- 共享 `Popover` 继续负责 Portal、fixed 定位和碰撞处理。若现有 viewport clamp 不能满足“底部不足向上展开”，只在该原语中补充自动翻转，调用方不另写浮层定位。
- `ChatHeader` 与移动端 Sidebar trigger 只调整首行布局；桌面侧栏和 Chat 正文滚动模型不变。
- `researchProcess` 只修正研究摘要投影，不修改 Web Search 编排、SSE 协议或 custom renderer。

## 2. Conversation Group Contract

浏览器按本地自然日生成边界并传给 Server Action：

```ts
interface ConversationGroupBoundaries {
  todayStart: string;
  yesterdayStart: string;
  dayBeforeYesterdayStart: string;
  sevenDaysAgoStart: string;
  thirtyDaysAgoStart: string;
}

type ConversationGroupKey =
  | "pinned"
  | "today"
  | "yesterday"
  | "dayBeforeYesterday"
  | "withinWeek"
  | "withinMonth"
  | "earlier"
  | "archived";

interface ConversationGroupSummary {
  key: ConversationGroupKey;
  total: number;
}

interface ConversationGroupPage {
  key: ConversationGroupKey;
  items: ConversationNavigationItem[];
  nextCursor: string | null;
}
```

- Client 以本地当天 00:00 为起点，用 `Date.setDate` 分别减 1、2、7、30 个自然日并序列化为 ISO 时间；这与现有 `dayBucket` 一致，也允许夏令时日不是固定 24 小时。Server Action 用 Zod 校验 ISO 时间且要求五个边界严格递减，在查询前拒绝畸形或乱序输入；服务端不能使用服务器时区重新计算。
- 摘要只返回各组真实计数，不返回完整行；仅 `total > 0` 的标题显示。置顶和归档使用独立 predicate，普通时间组排除二者，保证一条会话只属于一个组。
- 首次 RSC 继续使用现有全局 30 条键集窗口。hydration 后获取摘要，并把初始项目按同一边界归组；首屏已有项目立即显示，不等待摘要。
- 每个分组请求上限为 20，排序和 cursor 继续使用 `updated_at DESC, id DESC`。页合并按 ID 去重并按完整排序键排序；`nextCursor = null` 即本组末页。
- “更早”和“归档”初始折叠，展开时才请求本组第一页。若当前会话不在已加载窗口，继续按 ID 获取并补入对应组，即使该组折叠或尚未分页。

数据流：

```text
RSC <= 30 rows -> Sidebar immediate groups
browser local boundaries -> summary action -> visible headers + totals
expand/load group -> group page action -> dedupe/sort -> independent group state
deep-linked current id -> owned item action -> matching group -> visible/highlighted item
```

## 3. Client State And Races

每组维护独立的 `idle | loading | ready | failed`、`items`、`nextCursor` 和 request generation。摘要刷新或 RSC 替换时提升 generation；旧 generation 的迟到响应不得写回。并发重复点击同一组时只保留一次有效请求。

- 点击“加载更多”后立即进入 loading；`navigator.onLine === false` 时直接进入 failed，并显示可重试反馈。
- 在线请求采用 10 秒 UI 超时。Server Action 本身不保证可取消，因此超时只结束当前 UI 请求并提升 generation；迟到结果被忽略，已有项目不清空。
- 重试沿用该组原 cursor；成功后清除错误，末页隐藏加载按钮并保留标题和总数。

## 4. Conversation Actions And Position

- 复用已有 `renameConversation(id, title)`，在会话菜单加入重命名入口。使用轻量受控编辑 UI，标题 trim 后必须非空，并遵守服务端现有或同步补齐的长度上限；保存中禁用重复提交，失败保留输入并显示错误。
- 菜单保留置顶/取消置顶、归档/恢复、删除。操作前记录当前会话 DOM ref；成功合并/刷新并发生重排后，在下一布局帧调用 `scrollIntoView({ block: "nearest" })`，只移动 Sidebar 滚动容器，不影响 Chat 正文。
- 会话菜单改用共享 `Popover`，默认下展，底部不足时自动上翻；Portal 面板不能改变列表 `scrollHeight`。菜单展开时 trigger 维持可见。
- trigger 在 `group-hover`、`group-focus-within`、自身 `focus-visible` 和菜单打开时均为可见；键盘可打开、执行、Escape/外部点击关闭，关闭后焦点返回 trigger。

## 5. Status And Responsive Contracts

- 生成中同时保留旋转图标和稳定的非旋转视觉状态，确保 reduced-motion 下仍能辨识；状态变化不改变行高或挤压操作按钮。
- 移动端删除 Sidebar 的独立 Logo header，保留 44px 菜单 trigger，并与 `ChatHeader` 的标题、输出样式、分享处于同一 `h-14` 首行。390px 必须无横向溢出；桌面结构不变。

研究状态优先级：

| Canonical/Tool 状态 | Answer 边界 | 整体状态 |
|---|---|---|
| 任一步骤 `running` 或 Web Search `calling/running` | 任意 | `running` |
| 无活动步骤 | `phase=answering/completed`（协议定义为即将/已经输出正文）或已有 `firstContentAt` | `completed` |
| 无活动步骤 | 尚未进入正文且非终态 | 保持既有错误/等待投影 |

`answering` 只有在服务端准备结束、首个非空正文之前才进入，因此它就是“即将输出正文”的 canonical 边界；实现不能从任意 UI 状态自行推断该边界。总体 phase 即使已经是 `answering`，只要搜索仍在运行，也不能显示“研究完成”。流式和历史快照统一走该纯函数。

## 6. Compatibility And Rollback

- 不改变现有全局 `listConversations` cursor 语义、消息搜索、聊天流 store、SSE、数据库 schema 或公开 API。
- 不恢复暗色主题，不调整 custom renderer，不引入 React Query/SWR 或新浮层依赖。
- 分组摘要/分页是新增受控读取路径；出现回归时可回退 Sidebar 到现有全局窗口，既有会话动作和数据不受损。
- UI 操作均基于现有 Server Action，失败时保留服务端事实和已加载列表；不做不可逆数据迁移。

## 7. Risks

- Client 本地边界与数据库 UTC 时间比较容易产生边界错误，必须覆盖跨日、周/月边界和时区测试。
- RSC、摘要、分组页与会话动作可能交错返回，generation 和 ID 去重缺一不可。
- Popover 自动翻转属于共享原语改动，需回归现有调用方的 top/bottom 显式定位。
