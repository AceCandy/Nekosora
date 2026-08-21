import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Modal from "./Modal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("Modal", () => {
  it("uses the visible title as its accessible name", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => {}} title="Settings">
        content
      </Modal>,
    );
    const titleId = html.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1];

    expect(titleId).toBeTruthy();
    expect(html).toContain(`<h2 id="${titleId}"`);
    expect(html).not.toMatch(/<dialog[^>]*aria-label=/);
    expect(html).toContain('aria-label="close"');
  });

  it("uses ariaLabel only when there is no visible title", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => {}} ariaLabel="Image preview">
        content
      </Modal>,
    );

    expect(html).toMatch(/<dialog[^>]*aria-label="Image preview"/);
    expect(html).not.toMatch(/<dialog[^>]*aria-labelledby=/);
  });
});
