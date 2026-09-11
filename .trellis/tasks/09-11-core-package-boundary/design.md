# 设计

Core 内部使用相对路径；应用共享引用使用 `@nekusora/core/<subpath>`，优先复用已存在的同文件导出。只为实际消费文件补显式导出，不以通配符暴露所有实现和测试。

Web 的 session、auth-client、output-modes/service、render-styles/service、settings-control/runtime 保持 `@/lib/` 本地引用；共享 mock 路径与 import 同步替换。删除 Core/Gateway/Worker 别名，Web 只保留本地 `@`、`@shared`、`@features`。

机械替换仅更改模块路径字符串，使用迁移前文件内容生成 patch，并对比其他字节。构建及已有测试验证包导出解析、动态加载和 mock 单例。包内业务不移动，回滚只需反向应用本批 diff。
