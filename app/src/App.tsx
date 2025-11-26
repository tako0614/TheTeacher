import { A, Route, Router, useLocation } from "@solidjs/router";
import {
  For,
  Show,
  createMemo,
  createSignal,
  type Accessor,
  type Component,
  type ParentComponent,
} from "solid-js";

import { AuthProvider } from "./lib/auth-store";
import { SettingsProvider } from "./lib/settings-store";
import { NewLearningDraftProvider } from "./lib/new-learning-draft-store";
import { ToastProvider } from "./lib/toast-store";
import { surfaces } from "./surfaces";
import ToastContainer from "./components/ToastContainer";

const Nav: Component<{ activePath: Accessor<string>; onNavigate?: () => void }> = (props) => (
  <nav class="space-y-2">
    <For each={surfaces}>
      {(surface) => {
        const isActive = () => props.activePath() === surface.path;

        return (
          <A
            href={surface.path}
            class={`flex flex-col rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              isActive()
                ? "border-indigo-200 bg-indigo-50 text-indigo-800 shadow-sm"
                : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
            }`}
            onClick={() => props.onNavigate?.()}
          >
            <span>{surface.name}</span>
            <span class="text-xs font-normal text-slate-500">
              {surface.description}
            </span>
          </A>
        );
      }}
    </For>
  </nav>
);

const AppShell: ParentComponent = (props) => {
  const location = useLocation();
  const activePath = createMemo(() => location.pathname);
  const [isMenuOpen, setIsMenuOpen] = createSignal(false);

  const closeMenu = () => setIsMenuOpen(false);
  const toggleMenu = () => setIsMenuOpen((prev) => !prev);

  return (
    <div class="min-h-screen bg-slate-50 px-4 py-6 md:px-6 md:py-10">
      <ToastContainer />
      <div class="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Mobile Header */}
        <div class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 p-4 md:hidden">
          <div class="flex items-center gap-2">
            <p class="text-xs font-semibold text-indigo-600">TheTeacher</p>
            <span class="text-sm font-bold text-slate-900">
              {surfaces.find((s) => s.path === activePath())?.name ?? "学習一覧"}
            </span>
          </div>
          <button
            class="rounded-lg border border-slate-200 p-2 text-slate-700 transition hover:bg-slate-100"
            onClick={toggleMenu}
            aria-label="メニューを開く"
          >
            <Show
              when={!isMenuOpen()}
              fallback={
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              }
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Show>
          </button>
        </div>

        {/* Mobile Menu Drawer */}
        <Show when={isMenuOpen()}>
          <div class="fixed inset-0 z-40 md:hidden">
            {/* Backdrop */}
            <div class="absolute inset-0 bg-black/30" onClick={closeMenu} />
            {/* Drawer */}
            <div class="absolute right-0 top-0 h-full w-72 max-w-[80vw] overflow-y-auto bg-white p-4 shadow-xl">
              <div class="flex items-center justify-between pb-4">
                <p class="text-sm font-semibold text-indigo-600">TheTeacher</p>
                <button
                  class="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                  onClick={closeMenu}
                  aria-label="メニューを閉じる"
                >
                  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <Nav activePath={activePath} onNavigate={closeMenu} />
            </div>
          </div>
        </Show>

        <div class="grid gap-6 md:grid-cols-[280px_1fr]">
          {/* Desktop Sidebar */}
          <aside class="hidden border-slate-200 bg-slate-50/60 p-6 md:block md:border-r">
            <div class="space-y-2">
              <p class="text-xs font-semibold text-indigo-600">TheTeacher</p>
              <h1 class="text-lg font-bold text-slate-900">
                AI-firstな学習体験をつくるTauri + SolidJSベースのアプリ
              </h1>
              <p class="text-sm text-slate-600">
                PLAN.mdで定義したサーフェスをたどるためのナビゲーションを用意しました。各リンクから画面の殻を広げていきます。
              </p>
            </div>

            <div class="mt-6">
              <p class="text-xs font-semibold uppercase text-slate-500">
                Surfaces
              </p>
              <div class="mt-2">
                <Nav activePath={activePath} />
              </div>
            </div>
          </aside>

          <section class="p-4 md:p-6">
            {props.children}
          </section>
        </div>
      </div>
    </div>
  );
};

const App: Component = () => (
  <AuthProvider>
    <SettingsProvider>
      <NewLearningDraftProvider>
        <ToastProvider>
          <Router root={AppShell}>
            <For each={surfaces}>
              {(surface) => (
                <Route path={surface.path} component={surface.component} />
              )}
            </For>
            <Route path="*" component={surfaces[0].component} />
          </Router>
        </ToastProvider>
      </NewLearningDraftProvider>
    </SettingsProvider>
  </AuthProvider>
);

export default App;
