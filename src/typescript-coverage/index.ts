import {
  Disposable,
  Range,
  TextEditor,
  TextEditorDecorationType,
  window,
  workspace,
} from 'vscode';
import {
  getTypeScriptDecorations,
  getTypeScriptIntrospection,
} from '../utils/env';

import { hostDiscoverableMessageChannel } from '../utils/discoverable-message-channels';
import { BroadcastHandlers } from '../utils/handlers';
import {
  createResource,
  empty,
  useEffect,
  useMemo,
  useResource,
  useState,
} from '../utils/hooks';
import {
  createNode,
  ManagedDisposableResult,
} from '../utils/managed-disposable';
import { useRegisteredCommand } from '../core';
import { TypeIntrospectionProvider } from '../type-introspection';
import { hydrateValue } from '../utils/hydration';

const visibleEditorsResource = createResource(() => {
  const [editors, setEditors] = useState(window.visibleTextEditors);
  useEffect(
    () => window.onDidChangeVisibleTextEditors(setEditors),
    [setEditors]
  );
  return editors;
});

function mergeOverlappingRanges(ranges: Array<{ pos: number; end: number }>) {
  const sortedRanges = ranges.slice().sort((a, b) => a.pos - b.pos);
  let i = 0;
  const result: Array<{ pos: number; end: number }> = [];
  while (i < sortedRanges.length) {
    const next = { ...sortedRanges[i] };
    while (++i < sortedRanges.length && sortedRanges[i].pos < next.end) {
      next.end = Math.max(next.end, sortedRanges[i].end);
    }
    result.push(next);
  }
  return result;
}

async function fetchTypeScriptDecorations(
  editors: TextEditor[],
  host: { handlers: BroadcastHandlers }
) {
  const editorsByPath = new Map(
    editors
      .filter(editor => !!editor.document.fileName.match(/\.ts(x)?$/))
      .map(editor => [editor.document.fileName, editor])
  );

  const sources = await host.handlers.invoke(getTypeScriptDecorations, {
    absFilePaths: [...editorsByPath.keys()],
  });

  return sources.flatMap(source =>
    source.map(({ absFilePath, anyDecorations }) => {
      const editor = editorsByPath.get(absFilePath);
      if (!editor) {
        throw new Error('Internal error: Missing editor');
      }
      return {
        editor,
        ranges: mergeOverlappingRanges(anyDecorations).map(({ pos, end }) => {
          const endPosition = editor.document.positionAt(end);
          const rawText = editor.document.getText(
            new Range(editor.document.positionAt(pos), endPosition)
          );
          const trimmedText = rawText.trimStart();
          return new Range(
            editor.document.positionAt(
              pos + rawText.length - trimmedText.length
            ),
            endPosition
          );
        }),
      };
    })
  );
}

function debounce<T>(
  millis: number,
  fn: () => Promise<T>
): () => Promise<empty | T> {
  let cancel: undefined | (() => void) = undefined;
  return () => {
    if (cancel) cancel();
    return new Promise((resolve, reject) => {
      const interval = setTimeout(() => {
        fn().then(resolve).catch(reject);
      }, millis);
      cancel = () => {
        clearTimeout(interval);
        resolve(empty);
      };
    });
  };
}

function TypeFetcher({
  host,
  decorationStyle,
}: {
  host: { handlers: BroadcastHandlers };
  decorationStyle: TextEditorDecorationType;
}) {
  // FIXME: Move this to `type-introspection`
  useRegisteredCommand('demo.get-typescript-introspection', async () => {
    const editor = window.activeTextEditor;
    if (editor) {
      const values = (
        await host.handlers.invoke(getTypeScriptIntrospection, {
          absFilePath: editor.document.fileName,
          pos: editor.document.offsetAt(editor.selection.start),
          end: editor.document.offsetAt(editor.selection.end),
        })
      )
        .map(v => v && hydrateValue(v))
        .filter(v => !!v);

      if (values.length > 0) {
        window.createTreeView('type-introspection-ui', {
          treeDataProvider: new TypeIntrospectionProvider({
            context: '',
            node: values[0]!,
          }),
          showCollapseAll: true,
        });
      }
    }
  });

  const editors = useResource(visibleEditorsResource);
  const update = useMemo(() => {
    const debounced = debounce(200, () =>
      fetchTypeScriptDecorations(editors, host)
    );
    return async () => {
      const results = await debounced();
      if (results !== empty) {
        for (const { editor, ranges } of results) {
          editor.setDecorations(
            decorationStyle,
            ranges.map(range => ({
              range,
              hoverMessage: 'This expression evaluates to `any`',
            }))
          );
        }
      }
    };
  }, [editors, host, decorationStyle]);

  useEffect(() => {
    update();
    return Disposable.from(
      window.onDidChangeTextEditorSelection(update),
      window.onDidChangeTextEditorVisibleRanges(update),
      workspace.onDidChangeTextDocument(update)
    );
  }, [update]);

  return undefined;
}

export function TypeScriptCoverageDecorations(): ManagedDisposableResult {
  const [host, setHost] = useState(
    undefined as undefined | { handlers: BroadcastHandlers }
  );

  // FIXME
  // const config = useConfiguration('demo');
  // const enabled = config.get('enable-type-coverage-decorations') as boolean;
  // const style = config.get('type-coverage-decoration-style');

  const decorationStyle = useMemo(
    () =>
      window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 0, 0, 0.13)',
        borderRadius: '4px',
      }),
    // style is a new ref each render
    [
      /* JSON.stringify(style) */
    ]
  );

  useEffect(async () => {
    console.log('starting host', '!!!', `${process.pid}`);
    setHost(
      await hostDiscoverableMessageChannel({
        clientKeys: [`${process.pid}`],
        onClose(): undefined {
          console.warn('host closed');
          return;
        },
      })
    );
  }, []);

  return {
    decorationStyle,
    typeFetcher: host
      ? createNode(TypeFetcher, { host, decorationStyle })
      : undefined,
  };
}
