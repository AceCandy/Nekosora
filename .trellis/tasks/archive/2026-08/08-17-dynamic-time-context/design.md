# 技术设计

## 边界

只修改现有时间提示和搜索工具契约，不新增共享时钟服务或持久化状态。每个入口在调用时使用 `new Date()`，并用标准库 `Intl.DateTimeFormat` 转成 `Asia/Shanghai` 日期和时间。

## 数据流

1. 主聊天：`prepareChatContext` 每轮构造时间上下文，交给 `assembleContext` 合并为 system slot。
2. 逻辑搜索工具：主模型从时间上下文读取当前时间，按工具 schema 生成 `freshness` 或日期范围；执行器在调用时把 freshness 转成实际日期范围。
3. 应用侧搜索词重写：`rewriteSearchQuery` 在调用时构造时间提示，避免自行推断年份。
4. Hosted Search：`buildHostedSearchPrompt` 在调用时构造上海时区时间提示；已有检索范围继续按 UTC 解释。

## 取舍

- 不在 `generateChat` 底层全局注入，避免污染标题、摘要、记忆和 JSON 结构化任务。
- 不建立请求级时钟对象；用户已明确允许各调用按当下时间计算，下一轮必须得到新时间。
- 不修改已有 UTC 检索范围边界；只调整当前时刻的展示时区。
- 不在执行器中用关键词正则猜测“最近”，由模型通过现有结构化参数表达，保持多语言与查询内容边界。

## 回滚

变更均为提示词、注释和测试，可按文件回退；无数据库迁移和数据写入。
