import { A, Route, Router, useLocation } from "@solidjs/router";
import {
  For,
  createMemo,
  type Accessor,
  type Component,
  type ParentComponent,
} from "solid-js";

import { SettingsProvider } from "./lib/settings-store";
import { surfaces } from "./surfaces";

const Nav: Component<{ activePath: Accessor<string> }> = (props) => (
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

  return (
    <div class="min-h-screen bg-slate-50 px-6 py-10">
      <div class="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="grid gap-6 md:grid-cols-[280px_1fr]">
          <aside class="border-b border-slate-200 bg-slate-50/60 p-6 md:border-b-0 md:border-r">
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

          <section class="p-6">
            {props.children}
          </section>
        </div>
      </div>
    </div>
  );
};

const App: Component = () => (
  <SettingsProvider>
    <Router root={AppShell}>
      <For each={surfaces}>
        {(surface) => (
          <Route path={surface.path} component={surface.component} />
        )}
      </For>
      <Route path="*" component={surfaces[0].component} />
    </Router>
  </SettingsProvider>
);

export default App;
