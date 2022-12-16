import {
  Command,
  Range,
  TextDocumentShowOptions,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode';
import type { TypeNode } from '../language-server-plugin';

const typeIcons = {
  Array: 'symbol-interface',
  Class: 'symbol-interface',
  ObjectLiteral: 'symbol-interface',
  TypeLiteral: 'symbol-interface',
  Interface: 'symbol-interface',
  Union: 'symbol-class',
  Intersection: 'symbol-class',
  // TODO: wrong symbol
  Generic: 'symbol-variable',
  Unhandled: 'question',
} as const;

const primitiveIcons = {
  string: 'symbol-variable',
  number: 'symbol-variable',
  bigint: 'symbol-variable',
  boolean: 'symbol-variable',
  undefined: 'symbol-variable',
  any: 'question',
  unknown: 'symbol-variable',
  symbol: 'symbol-variable',
  never: 'symbol-variable',
  null: 'symbol-variable',
} as const;

function getIcon(element: TypeNode): ThemeIcon {
  const { type } = element;

  if (type === 'Primitive') {
    return new ThemeIcon(
      element.kind ? primitiveIcons[element.kind] : 'symbol-variable'
    );
  }

  return new ThemeIcon(typeIcons[type]);
}

function getCommand(element: TypeNode): Command | undefined {
  const { location } = element;

  if (!location) {
    return undefined;
  }

  if (element.type === 'Array') {
    return getCommand(element.elementType);
  }

  const { absFilePath, pos, end } = location;
  const uri = Uri.file(absFilePath);

  const options: TextDocumentShowOptions = {
    selection: new Range(pos.line, pos.character, end.line, end.character),
  };

  return {
    title: 'Go to Definition',
    command: 'vscode.open',
    arguments: [uri, options],
  };
}

function getLabel(
  context: string | undefined,
  element: TypeNode
): { label: string; description?: string } {
  const { type } = element;

  let labelBuilder = context === undefined ? '' : `${context} `;
  let description: undefined | string;

  if (type === 'Primitive') {
    labelBuilder += element.value === undefined ? element.kind : element.value;
  } else if (type === 'Array') {
    labelBuilder += `Array<${getLabel(undefined, element.elementType).label}>`;
  } else if (
    type === 'Class' ||
    type === 'Interface' ||
    type === 'TypeLiteral'
  ) {
    const { name, typeArguments } = element;
    if (element.name) {
      if (!typeArguments || typeArguments.length === 0) {
        labelBuilder += name;
      } else {
        labelBuilder += `${name}<${typeArguments
          .map(t => getLabel(undefined, t).label)
          .join(', ')}>`;
      }
    } else {
      description = type === 'TypeLiteral' ? 'anonymous type' : type;
    }
  } else if (
    type === 'Generic' ||
    type === 'Intersection' ||
    type === 'Union'
  ) {
    if (element.name) {
      labelBuilder += element.name;
    } else {
      description = type;
    }
  } else if (type === 'ObjectLiteral') {
    if (element.name) {
      labelBuilder += `typeof ${element.name}`;
    } else {
      description = 'Object'; // '{ /* ... */ }';
    }
  } else {
    description = '[[unhandled]]';
  }

  return { label: labelBuilder.trimEnd(), description };
}

/**
 * @see https://code.visualstudio.com/api/extension-guides/tree-view#tree-data-provider
 */
export class TypeIntrospectionProvider
  implements TreeDataProvider<{ context?: string; node: TypeNode }>
{
  constructor(private readonly root: { context?: string; node: TypeNode }) {}

  getTreeItem(item: { context?: string; node: TypeNode }): TreeItem {
    let collapsibleState = TreeItemCollapsibleState.None;

    if (this.getChildren(item).length > 0) {
      collapsibleState =
        this.root === item
          ? TreeItemCollapsibleState.Expanded
          : TreeItemCollapsibleState.Collapsed;
    }

    return {
      ...getLabel(item.context, item.node),
      command: getCommand(item.node),
      iconPath: getIcon(item.node),
      collapsibleState,
    };
  }

  getChildren(item?: { context?: string; node: TypeNode }) {
    if (!item) {
      if (!this.root) {
        return [];
      }

      return [this.root];
    }
    const element = item.node;

    const { type } = element;

    if (
      type === 'ObjectLiteral' ||
      type === 'TypeLiteral' ||
      type === 'Interface' ||
      type === 'Class'
    ) {
      // Merge property name into the child node
      return Object.entries(element.properties).map(([context, node]) => ({
        // TODO detect invalid identifier strings
        context: `${context}: `,
        node,
      }));
    } else if (type === 'Union' || type === 'Intersection') {
      return element.types.map(node => ({
        context: type === 'Union' ? '|' : '&',
        node,
      }));
    } else if (type === 'Array') {
      // return this.getChildren();
      return [{ context: '[i: number]:', node: element.elementType }];
    }

    return [];
  }
}
