import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeAll, describe, expect, it, vi } from "vitest";

import App from "./App";

const surfaceTitles = [
  "学習一覧",
  "学習詳細",
  "演習",
  "汎用AIチャット",
  "教材設定",
  "過去教材から新しい学習作成",
  "設定",
];

describe("App navigation", () => {
  beforeAll(() => {
    // jsdom does not implement scrollTo but the router calls it on navigation
    window.scrollTo = vi.fn();
  });

  it("renders navigation links for each PLAN surface", () => {
    render(() => <App />);

    surfaceTitles.forEach((title) => {
      expect(
        screen.getByRole("link", { name: new RegExp(`^${title}`) }),
      ).toBeInTheDocument();
    });
  });

  it("navigates to surfaces when links are clicked", async () => {
    render(() => <App />);

    expect(
      screen.getByRole("heading", { name: "学習一覧" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^汎用AIチャット/ }));
    expect(
      await screen.findByText("Tool Call ログ"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^演習/ }));
    expect(await screen.findByText(/手書き入力/)).toBeInTheDocument();
  });

  it("shows surface-specific UI elements", async () => {
    render(() => <App />);

    expect(screen.getByPlaceholderText("タイトル・タグ検索")).toBeInTheDocument();
    expect(screen.getByText(/学習を作成/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^学習詳細/ }));
    expect(await screen.findByText("生成履歴")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^設定/ }));
    expect(await screen.findByText("教科プリセット")).toBeInTheDocument();
  });
});
