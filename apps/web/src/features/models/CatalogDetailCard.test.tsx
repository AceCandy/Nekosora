import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import zh from "../../../messages/zh-CN.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: keyof typeof zh.models.catalogDetail) => zh.models.catalogDetail[key],
}));
vi.mock("./catalog-actions", () => ({ setCatalogImageGeneration: vi.fn() }));

import CatalogDetailCard from "./CatalogDetailCard";

const catalog = {
  id: "catalog-chat", name: "双能力模型", canonicalModelId: "dual-model",
  modelType: "chat", capabilities: { imageGeneration: true, vision: true },
};

describe("模型模板能力预览", () => {
  it("管理员看到出图方式、共享影响和同步说明，旧模板沿用 Images", () => {
    const html = renderToStaticMarkup(<CatalogDetailCard catalog={catalog} editable />);
    expect(html).toContain('<select');
    expect(html).toContain('value="openai-images" selected=""');
    expect(html).toContain('Responses 绘图工具');
    expect(html).toContain("所有使用此模板的模型");
    expect(html).toContain("pi 同步会保留");
    expect(html).toContain("对话");
  });

  it("普通预览只读，仍展示图像生成能力", () => {
    const html = renderToStaticMarkup(<CatalogDetailCard catalog={catalog} />);
    expect(html).not.toContain('<select');
    expect(html).toContain("图像生成");
  });

  it("未标记的模板默认关闭", () => {
    const html = renderToStaticMarkup(<CatalogDetailCard catalog={{ ...catalog, capabilities: {} }} editable />);
    expect(html).toContain('value="off" selected=""');
  });
});
