import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("renders key surfaces", () => {
    render(() => <App />);
    expect(
      screen.getByText(/AI-firstな学習体験をつくる/i),
    ).toBeInTheDocument();
    expect(screen.getByText("学習一覧")).toBeInTheDocument();
    expect(screen.getByText("演習モード")).toBeInTheDocument();
  });
});
