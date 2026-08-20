import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/dynamic", () => ({
  default: () => function MockSyntaxHighlighter({ children }: { children: React.ReactNode }) {
    return <pre>{children}</pre>;
  },
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  prism: {},
}));

vi.mock("@/shared/components/mermaid/MermaidDiagram", () => ({
  MermaidDiagram: () => <div data-testid="mermaid" />,
}));

import { ArtifactPanel, type Artifact } from "./ArtifactPanel";

const noop = () => {};

function renderArtifact(kind: "svg" | "html", content: string) {
  const artifact: Artifact = {
    id: `artifact-${kind}`,
    kind,
    title: `${kind} preview`,
    language: kind,
    content,
  };

  return renderToStaticMarkup(<ArtifactPanel artifact={artifact} onClose={noop} />);
}

describe("ArtifactPanel preview isolation", () => {
  it.each([
    ["svg", '<svg id="model-svg"><script>parent.document.body.dataset.pwned = "1"</script></svg>'],
    ["html", '<main id="model-html">preview</main>'],
  ] as const)("通过 sandbox iframe 渲染 %s artifact", (kind, content) => {
    const html = renderArtifact(kind, content);

    expect(html).toContain("<iframe");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toMatch(/<(?:svg|main)\b[^>]*id="model-/);
    expect(html).toContain('aria-label="copy"');
    expect(html).toContain('aria-label="download"');
  });
});
