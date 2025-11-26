import katex from "katex";
import mermaid from "mermaid";
import {
  For,
  Show,
  createMemo,
  createSignal,
  createEffect,
  type Component,
  Match,
  Switch,
} from "solid-js";
import { logger } from "../../lib/logger";

import type {
  RichContentBlock,
  RichContentDocument,
  RichDiagramBlock,
  RichListBlock,
  RichMathBlock,
  RichStructuredDataBlock,
  RichTableBlock,
  RichTimelineBlock,
  StructuredValue,
} from "@theteacher/shared";

import { normalizeRichContentDocument } from "../../lib/rich-content";

interface Props {
  value: unknown;
}

const escapeHtml = (unsafe: string) => {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const renderTextWithMath = (text: string) => {
  const regex = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g;
  const parts = text.split(regex);
  return parts
    .map((part) => {
      if (part.startsWith("$$") && part.endsWith("$$")) {
        try {
          return katex.renderToString(part.slice(2, -2), {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          return escapeHtml(part);
        }
      }
      if (part.startsWith("$") && part.endsWith("$")) {
        try {
          return katex.renderToString(part.slice(1, -1), {
            displayMode: false,
            throwOnError: false,
          });
        } catch {
          return escapeHtml(part);
        }
      }
      return escapeHtml(part);
    })
    .join("");
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
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={html()}
    />
  );
};

const TextContent: Component<{ block: Extract<RichContentBlock, { type: "text" }> }> = (props) => {
  const html = createMemo(() => renderTextWithMath(props.block.text));

  return (
    <Switch>
      <Match when={props.block.variant === "heading" || props.block.variant === "subheading"}>
        <div>
          <p class="text-xs uppercase text-slate-500">
            {props.block.badge}
          </p>
          <p
            class={`font-semibold text-slate-900 ${
              props.block.variant === "heading" ? "text-base" : "text-sm"
            }`}
            // eslint-disable-next-line solid/no-innerhtml
            innerHTML={html()}
          />
        </div>
      </Match>
      <Match when={props.block.variant === "quote"}>
        <blockquote class="border-l-4 border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm italic text-indigo-900">
          {props.block.text}
        </blockquote>
      </Match>
      <Match when={props.block.variant === "code"}>
        <pre class="overflow-x-auto rounded-md bg-slate-900/90 p-3 text-xs text-slate-50">
          <code>{props.block.text}</code>
        </pre>
      </Match>
      <Match when={true}>
        <p
          class="text-sm leading-relaxed text-slate-800"
          // eslint-disable-next-line solid/no-innerhtml
          innerHTML={html()}
        />
      </Match>
    </Switch>
  );
};

const TableBlock: Component<{ block: RichTableBlock }> = (props) => {
  const [sortConfig, setSortConfig] = createSignal<{ colIndex: number; direction: "asc" | "desc" } | null>(null);

  const handleSort = (index: number) => {
    const current = sortConfig();
    if (current?.colIndex === index && current.direction === "asc") {
      setSortConfig({ colIndex: index, direction: "desc" });
    } else if (current?.colIndex === index && current.direction === "desc") {
      setSortConfig(null);
    } else {
      setSortConfig({ colIndex: index, direction: "asc" });
    }
  };

  const sortedRows = createMemo(() => {
    const config = sortConfig();
    if (!config) return props.block.rows;

    const { colIndex, direction } = config;
    return [...props.block.rows].sort((a, b) => {
      const valA = a[colIndex];
      const valB = b[colIndex];

      if (valA === valB) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;

      const comparison = valA < valB ? -1 : 1;
      return direction === "asc" ? comparison : -comparison;
    });
  });

  return (
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
                {(header, index) => (
                  <th 
                    class="cursor-pointer px-3 py-2 text-left hover:bg-slate-100 select-none"
                    onClick={() => handleSort(index())}
                  >
                    <div class="flex items-center gap-1">
                      {header}
                      <Show when={sortConfig()?.colIndex === index()}>
                        <span>{sortConfig()?.direction === "asc" ? "↑" : "↓"}</span>
                      </Show>
                    </div>
                  </th>
                )}
              </For>
            </tr>
          </thead>
        </Show>
        <tbody>
          <For each={sortedRows()}>
            {(row) => (
              <tr class="border-t border-slate-100 text-sm text-slate-800 hover:bg-slate-50">
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
};

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
                  <Show when={item.audioUrl}>
                    <audio
                      controls
                      src={item.audioUrl}
                      class="mt-2 h-8 w-full"
                    />
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

const TimelineBlock: Component<{ block: RichTimelineBlock }> = (props) => {
  const isHorizontal = () => props.block.layout === 'horizontal';
  
  return (
    <div class="w-full overflow-x-auto">
      <Show when={props.block.title}>
        <p class="mb-2 text-xs font-semibold uppercase text-slate-500">
          {props.block.title}
        </p>
      </Show>
      <Show 
        when={isHorizontal()}
        fallback={
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
        }
      >
        <div class="flex gap-4 min-w-max pb-4">
           <For each={props.block.events}>
              {(event) => (
                <div class="relative flex flex-col w-48">
                  <div class="flex items-center mb-2">
                    <div class="h-3 w-3 rounded-full border-2 border-white bg-indigo-500 shadow-sm z-10" />
                    <div class="h-0.5 w-full bg-indigo-100 -ml-1.5" />
                  </div>
                  <p class="font-semibold text-slate-900 text-sm">{event.label}</p>
                  <Show when={event.date}>
                    <p class="text-xs uppercase text-slate-500 mt-0.5">{event.date}</p>
                  </Show>
                  <Show when={event.description}>
                    <p class="text-slate-600 text-xs mt-1">{event.description}</p>
                  </Show>
                </div>
              )}
            </For>
        </div>
      </Show>
    </div>
  );
};

const MermaidDiagram: Component<{ content: string }> = (props) => {
  const [svg, setSvg] = createSignal<string>("");
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const content = props.content;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    
    const renderMermaid = async () => {
      try {
        mermaid.initialize({ startOnLoad: false, theme: 'default' });
        const { svg: renderedSvg } = await mermaid.render(id, content);
        setSvg(renderedSvg);
        setError(null);
      } catch (e) {
        logger.error("Mermaid diagram rendering failed", "RichContentRenderer", e);
        const errorMsg = e instanceof Error ? e.message : "図の描画に失敗しました";
        setError(errorMsg);
      }
    };
    
    void renderMermaid();
  });

  return (
    <div class="overflow-x-auto bg-white p-4 rounded-lg border border-slate-200">
      <Show
        when={!error()}
        fallback={
          <div class="flex flex-col items-center gap-2 py-4">
            <p class="text-rose-600 text-sm font-semibold">図の描画に失敗しました</p>
            <p class="text-slate-500 text-xs max-w-md text-center">{error()}</p>
            <details class="text-xs text-slate-400 mt-2">
              <summary class="cursor-pointer hover:text-slate-600">コードを表示</summary>
              <pre class="mt-2 p-2 bg-slate-50 rounded border border-slate-200 overflow-x-auto">
                <code>{props.content}</code>
              </pre>
            </details>
          </div>
        }
      >
        <div class="flex justify-center">
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div innerHTML={svg()} />
        </div>
      </Show>
    </div>
  );
};

interface DiagramNodePosition {
  id: string;
  label: string;
  description?: string;
  x: number;
  y: number;
}

const SimpleDiagram: Component<{ block: RichDiagramBlock }> = (props) => {
  const nodes = () => props.block.nodes || [];
  const edgesList = () => props.block.edges || [];

  const layout = () => props.block.layout ?? "horizontal";
  const positioned = createMemo<DiagramNodePosition[]>(() =>
    nodes().map((node, index) => ({
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
    edgesList()
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
  );
}

const DiagramBlock: Component<{ block: RichDiagramBlock }> = (props) => {
  return (
    <div class="rounded-lg border border-slate-200 bg-white p-4">
      <Show when={props.block.title}>
        <p class="text-xs font-semibold uppercase text-slate-500 mb-2">
          {props.block.title}
        </p>
      </Show>
      <Show when={props.block.description}>
        <p class="text-sm text-slate-600 mb-3">{props.block.description}</p>
      </Show>

      <Switch fallback={<SimpleDiagram block={props.block} />}>
        <Match when={props.block.format === "mermaid" && props.block.content}>
          <MermaidDiagram content={props.block.content!} />
        </Match>
        <Match when={props.block.format === "svg" && props.block.content}>
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div class="w-full overflow-x-auto" innerHTML={props.block.content!} />
        </Match>
      </Switch>
    </div>
  );
};

const JsonViewer: Component<{ data: StructuredValue; level?: number }> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(true);
  const level = () => props.level ?? 0;
  
  const isObject = () => typeof props.data === 'object' && props.data !== null;
  const isArray = () => Array.isArray(props.data);

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded());
  };

  return (
    <div class="font-mono text-xs leading-relaxed">
       <Show 
          when={isObject()} 
          fallback={<span class="text-slate-600">{String(props.data)}</span>}
        >
          <div class="flex items-start">
            <button 
              onClick={toggle} 
              class="mr-1 mt-0.5 text-slate-400 hover:text-slate-600"
            >
               {isExpanded() ? "▼" : "▶"}
            </button>
            
            <Show when={isExpanded()} fallback={<span class="text-slate-500">{isArray() ? '[...]' : '{...}'}</span>}>
               <div class="flex flex-col">
                 <span class="text-slate-500">{isArray() ? '[' : '{'}</span>
                 <div class="pl-4 border-l border-slate-100">
                    <Show when={isArray()}>
                      <For each={props.data as StructuredValue[]}>
                         {(item) => (
                            <div class="my-0.5">
                              <JsonViewer data={item} level={level() + 1} />
                              <span class="text-slate-400">,</span>
                            </div>
                         )}
                      </For>
                    </Show>
                    <Show when={!isArray()}>
                      <For each={Object.entries(props.data as Record<string, StructuredValue>)}>
                        {([key, val]) => (
                           <div class="flex my-0.5">
                             <span class="text-indigo-600 mr-2">"{key}":</span>
                             <JsonViewer data={val} level={level() + 1} />
                             <span class="text-slate-400">,</span>
                           </div>
                        )}
                      </For>
                    </Show>
                 </div>
                 <span class="text-slate-500">{isArray() ? ']' : '}'}</span>
               </div>
            </Show>
          </div>
       </Show>
    </div>
  )
}

const StructuredDataBlock: Component<{ block: RichStructuredDataBlock }> = (props) => (
  <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
    <Show when={props.block.title}>
      <p class="text-xs font-semibold uppercase text-slate-500 mb-2">
        {props.block.title}
      </p>
    </Show>
    <div class="bg-white rounded border border-slate-100 p-3 overflow-x-auto">
       <JsonViewer data={props.block.data} />
    </div>
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
      <TimelineBlock block={props.block as RichTimelineBlock} />
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

/**
 * Renders text with inline/block math expressions.
 * Uses KaTeX for math rendering and escapes all other text for safety.
 */
export const MathText: Component<{ text: string; class?: string }> = (props) => {
  const html = createMemo(() => renderTextWithMath(props.text));
  // eslint-disable-next-line solid/no-innerhtml -- renderTextWithMath escapes user input and only renders safe KaTeX output
  return <span class={props.class} innerHTML={html()} />;
};

export default RichContentRenderer;