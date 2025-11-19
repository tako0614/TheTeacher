import katex from "katex";
import {
  For,
  Show,
  createMemo,
  type Component,
  type JSX,
  Match,
  Switch,
} from "solid-js";

import type {
  RichContentBlock,
  RichContentDocument,
  RichDiagramBlock,
  RichListBlock,
  RichMathBlock,
  RichStructuredDataBlock,
  RichTableBlock,
  StructuredValue,
} from "@theteacher/shared";

import { normalizeRichContentDocument } from "../../lib/rich-content";

type Props = {
  value: unknown;
};

const MathSnippet: Component<{ block: RichMathBlock }> = (props) => {
  const html = createMemo(() =>
    katex.renderToString(props.block.latex, {
      throwOnError: false,
      displayMode: props.block.displayMode ?? true,
    }),
  );
  return (
    <div
      class="overflow-x-auto rounded-md bg-slate-50 px-3 py-2 text-slate-900"
      innerHTML={html()}
    />
  );
};

const TextContent: Component<{ block: Extract<RichContentBlock, { type: "text" }> }> = (props) => {
  const variant = props.block.variant ?? "paragraph";

  if (variant === "heading" || variant === "subheading") {
    return (
      <div>
        <p class="text-xs uppercase text-slate-500">
          {props.block.badge}
        </p>
        <p
          class={`font-semibold text-slate-900 ${
            variant === "heading" ? "text-base" : "text-sm"
          }`}
        >
          {props.block.text}
        </p>
      </div>
    );
  }
  if (variant === "quote") {
    return (
      <blockquote class="border-l-4 border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm italic text-indigo-900">
        {props.block.text}
      </blockquote>
    );
  }
  if (variant === "code") {
    return (
      <pre class="overflow-x-auto rounded-md bg-slate-900/90 p-3 text-xs text-slate-50">
        <code>{props.block.text}</code>
      </pre>
    );
  }
  return <p class="text-sm leading-relaxed text-slate-800">{props.block.text}</p>;
};

const TableBlock: Component<{ block: RichTableBlock }> = (props) => (
  <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <table class="w-full border-collapse text-sm">
      <Show when={props.block.caption}>
        <caption class="bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
          {props.block.caption}
        </caption>
      </Show>
      <Show when={(props.block.headers?.length ?? 0) > 0}>
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <For each={props.block.headers}>
              {(header) => <th class="px-3 py-2 text-left">{header}</th>}
            </For>
          </tr>
        </thead>
      </Show>
      <tbody>
        <For each={props.block.rows}>
          {(row) => (
            <tr class="border-t border-slate-100 text-sm text-slate-800">
              <For each={row}>
                {(cell) => (
                  <td class="px-3 py-2 align-top">
                    {cell === null ? "—" : String(cell)}
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  </div>
);

const ListItems: Component<{ block: RichListBlock }> = (props) => {
  const asArray = () =>
    props.block.ordered ? (
      <ol class="list-decimal space-y-1 pl-4 text-sm text-slate-800">
        <For each={props.block.items}>
          {(item) => (
            <li>
              {typeof item === "string" ? (
                item
              ) : (
                <div>
                  <p class="font-semibold">{item.title}</p>
                  <Show when={item.body}>
                    <p class="text-slate-600">{item.body}</p>
                  </Show>
                  <Show when={item.math}>
                    <div class="mt-1">
                      <MathSnippet
                        block={{
                          type: "math",
                          latex: item.math!,
                          displayMode: false,
                        }}
                      />
                    </div>
                  </Show>
                </div>
              )}
            </li>
          )}
        </For>
      </ol>
    ) : (
      <ul class="list-disc space-y-1 pl-4 text-sm text-slate-800">
        <For each={props.block.items}>
          {(item) => (
            <li>
              {typeof item === "string" ? (
                item
              ) : (
                <div>
                  <p class="font-semibold">{item.title}</p>
                  <Show when={item.body}>
                    <p class="text-slate-600">{item.body}</p>
                  </Show>
                </div>
              )}
            </li>
          )}
        </For>
      </ul>
    );

  return (
    <div>
      <Show when={props.block.title}>
        <p class="text-xs font-semibold uppercase text-slate-500">
          {props.block.title}
        </p>
      </Show>
      {asArray()}
    </div>
  );
};

type TimelineBlockData = Extract<RichContentBlock, { type: "timeline" }>;

const TimelineBlock: Component<{ block: TimelineBlockData }> = (props) => (
  <div>
    <Show when={props.block.title}>
      <p class="text-xs font-semibold uppercase text-slate-500">
        {props.block.title}
      </p>
    </Show>
    <ol class="mt-2 space-y-3 border-l-2 border-indigo-100 pl-4 text-sm">
      <For each={props.block.events}>
        {(event) => (
          <li class="relative">
            <span class="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-indigo-500 shadow-sm" />
            <p class="font-semibold text-slate-900">{event.label}</p>
            <Show when={event.date}>
              <p class="text-xs uppercase text-slate-500">{event.date}</p>
            </Show>
            <Show when={event.description}>
              <p class="text-slate-600">{event.description}</p>
            </Show>
          </li>
        )}
      </For>
    </ol>
  </div>
);

type DiagramNodePosition = {
  id: string;
  label: string;
  description?: string;
  x: number;
  y: number;
};

const DiagramBlock: Component<{ block: RichDiagramBlock }> = (props) => {
  const layout = () => props.block.layout ?? "horizontal";
  const positioned = createMemo<DiagramNodePosition[]>(() =>
    props.block.nodes.map((node, index) => ({
      ...node,
      x: layout() === "horizontal" ? 80 + index * 160 : 150,
      y: layout() === "horizontal" ? 80 : 40 + index * 120,
    })),
  );
  const chartWidth = createMemo(() =>
    layout() === "horizontal"
      ? Math.max(positioned().length * 160, 320)
      : 320,
  );
  const chartHeight = createMemo(() =>
    layout() === "horizontal"
      ? 200
      : Math.max(positioned().length * 120, 160),
  );
  const edges = createMemo(() =>
    (props.block.edges ?? [])
      .map((edge) => {
        const from = positioned().find((item) => item.id === edge.from);
        const to = positioned().find((item) => item.id === edge.to);
        if (!from || !to) return null;
        return { edge, from, to };
      })
      .filter(Boolean) as {
      edge: NonNullable<RichDiagramBlock["edges"]>[number];
      from: DiagramNodePosition;
      to: DiagramNodePosition;
    }[],
  );

  return (
    <div class="rounded-lg border border-slate-200 bg-white p-4">
      <Show when={props.block.title}>
        <p class="text-xs font-semibold uppercase text-slate-500">
          {props.block.title}
        </p>
      </Show>
      <Show when={props.block.description}>
        <p class="text-sm text-slate-600">{props.block.description}</p>
      </Show>
      <svg
        viewBox={`0 0 ${chartWidth()} ${chartHeight()}`}
        class="mt-3 w-full"
      >
        <For each={edges()}>
          {(item) => (
            <g>
              <line
                x1={item.from.x}
                y1={item.from.y}
                x2={item.to.x}
                y2={item.to.y}
                class="stroke-indigo-200"
                stroke-width="2"
              />
              <Show when={item.edge.label}>
                <text
                  x={(item.from.x + item.to.x) / 2}
                  y={(item.from.y + item.to.y) / 2 - 4}
                  class="fill-indigo-600 text-[10px]"
                >
                  {item.edge.label}
                </text>
              </Show>
            </g>
          )}
        </For>
        <For each={positioned()}>
          {(node) => (
            <g>
              <rect
                x={node.x - 60}
                y={node.y - 20}
                width="120"
                height="40"
                rx="10"
                class="fill-indigo-50 stroke-indigo-200"
                stroke-width="1"
              />
              <text
                x={node.x}
                y={node.y - 2}
                text-anchor="middle"
                class="fill-indigo-900 text-xs font-semibold"
              >
                {node.label}
              </text>
              <Show when={node.description}>
                <text
                  x={node.x}
                  y={node.y + 12}
                  text-anchor="middle"
                  class="fill-slate-500 text-[10px]"
                >
                  {node.description}
                </text>
              </Show>
            </g>
          )}
        </For>
      </svg>
    </div>
  );
};

const asKeyValueEntries = (
  data: StructuredValue,
): Array<[string, StructuredValue]> => {
  if (data === null) return [["値", data]];
  if (typeof data !== "object") return [["値", data]];
  if (Array.isArray(data)) {
    return data.map((value, index) => [`項目 ${index + 1}`, value]);
  }
  return Object.entries(data);
};

const formatStructuredValue = (value: StructuredValue): string => {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(formatStructuredValue).join(", ");
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

const StructuredDataBlock: Component<{ block: RichStructuredDataBlock }> = (props) => (
  <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
    <Show when={props.block.title}>
      <p class="text-xs font-semibold uppercase text-slate-500">
        {props.block.title}
      </p>
    </Show>
    <dl class="mt-2 grid gap-3 text-sm text-slate-800">
      <For each={asKeyValueEntries(props.block.data)}>
        {([key, value]) => (
          <>
            <dt class="font-semibold">{key}</dt>
            <dd class="whitespace-pre-line text-slate-600">
              {formatStructuredValue(value)}
            </dd>
          </>
        )}
      </For>
    </dl>
  </div>
);

const BlockRenderer: Component<{ block: RichContentBlock }> = (props) => (
  <Switch fallback={<pre class="text-xs text-slate-500">{JSON.stringify(props.block)}</pre>}>
    <Match when={props.block.type === "text"}>
      <TextContent block={props.block as Extract<RichContentBlock, { type: "text" }>} />
    </Match>
    <Match when={props.block.type === "math"}>
      <MathSnippet block={props.block as RichMathBlock} />
    </Match>
    <Match when={props.block.type === "table"}>
      <TableBlock block={props.block as RichTableBlock} />
    </Match>
    <Match when={props.block.type === "list"}>
      <ListItems block={props.block as RichListBlock} />
    </Match>
    <Match when={props.block.type === "timeline"}>
      <TimelineBlock block={props.block as TimelineBlockData} />
    </Match>
    <Match when={props.block.type === "diagram"}>
      <DiagramBlock block={props.block as RichDiagramBlock} />
    </Match>
    <Match when={props.block.type === "structured_data"}>
      <StructuredDataBlock block={props.block as RichStructuredDataBlock} />
    </Match>
  </Switch>
);

const SectionRenderer: Component<{ section: RichContentDocument["sections"][number] }> = (
  props,
) => (
  <section class="rounded-lg border border-slate-200 bg-white p-4">
    <Show when={props.section.title}>
      <h4 class="text-sm font-semibold text-slate-900">{props.section.title}</h4>
    </Show>
    <Show when={props.section.description}>
      <p class="text-sm text-slate-600">{props.section.description}</p>
    </Show>
    <div class="mt-3 space-y-3">
      <For each={props.section.blocks}>
        {(block) => <BlockRenderer block={block} />}
      </For>
    </div>
  </section>
);

const PlainFallback: Component<{ value: unknown }> = (props) => (
  <article class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
    <p>構造化データがまだ紐付いていません。プレビューを表示します。</p>
    <Show when={typeof props.value === "string"}>
      {(text) => <p class="mt-1 font-mono text-xs">{text()}</p>}
    </Show>
    <Show when={typeof props.value === "object"}>
      <pre class="mt-1 overflow-x-auto text-xs">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </Show>
  </article>
);

const RichContentRenderer: Component<Props> = (props) => {
  const doc = createMemo(() => normalizeRichContentDocument(props.value));
  const hasStructure = createMemo(
    () =>
      (doc()?.sections?.some((section) => section.blocks.length > 0) ?? false) ||
      ((doc()?.blocks.length ?? 0) > 0),
  );

  return (
    <Show when={doc()} fallback={<PlainFallback value={props.value} />}>
      {(document) => (
        <div class="space-y-4">
          <Show when={document().description}>
            <p class="text-sm text-slate-600">{document().description}</p>
          </Show>
          <Show when={document().sections.length}>
            <For each={document().sections}>
              {(section) => <SectionRenderer section={section} />}
            </For>
          </Show>
          <Show when={document().blocks.length}>
            <div class="space-y-3">
              <For each={document().blocks}>
                {(block) => <BlockRenderer block={block} />}
              </For>
            </div>
          </Show>
          <Show when={!hasStructure()}>
            <PlainFallback value={props.value} />
          </Show>
        </div>
      )}
    </Show>
  );
};

export default RichContentRenderer;
