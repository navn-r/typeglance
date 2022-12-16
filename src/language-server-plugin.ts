/* eslint-disable no-bitwise */
import { discoverMessageChannel } from './utils/discoverable-message-channels';

import {
  getTypeScriptDecorations,
  getTypeScriptIntrospection,
} from './utils/env';
import { execWithCache, dehydrateValue } from './utils/hydration';

import type {
  Node,
  Type,
  Symbol,
  LineAndCharacter,
  LiteralType,
} from 'typescript/lib/tsserverlibrary';

export default function init(modules: {
  typescript: typeof import('typescript/lib/tsserverlibrary');
}) {
  const ts = modules.typescript;

  const projects = new Set<ts.server.Project>();
  let channel: unknown;

  function create(info: ts.server.PluginCreateInfo) {
    if (
      // there is also a partial-semantic tsserver running that we don't want involved (or maybe it's the only one we want involved?)
      info.project.projectService.serverMode === ts.LanguageServiceMode.Semantic
    ) {
      const project = info.project;
      projects.add(project);
      if (!channel) {
        channel = discoverMessageChannel({
          timeoutMilliseconds: 15000,
          key: `${process.ppid}`,
        })
          .then(result => {
            result.handlerRegistry.register(getTypeScriptDecorations, input =>
              getDecorationRanges(input, ts, projects)
            );
            result.handlerRegistry.register(getTypeScriptIntrospection, input =>
              getIntrospection(input, ts, projects)
            );
          })
          .catch(err => {
            console.log(err);
          });
      }
      return {
        ...info.languageService,
        dispose() {
          projects.delete(project);
          info.languageService.dispose();
        },
      };
    }
    return info.languageService;
  }

  return { create };
}

/* Intermediate Data Types */

interface BaseTypeNode {
  type: string;

  // Only set in UI, not during resolution
  contextLabel?: string;

  location?: {
    absFilePath: string;
    pos: LineAndCharacter;
    end: LineAndCharacter;
  };

  // for debug only
  _type?: Type;
  _symbol?: Symbol;
}

interface UnhandledTypeNode extends BaseTypeNode {
  type: 'Unhandled';
}
// Primitive Literal + Primitive Intrinsic
interface PrimitiveTypeNode extends BaseTypeNode {
  type: 'Primitive';
  kind: ReturnType<typeof getPrimitiveTypeKind>;
  value?: string; // intrinsicName || value
}

// `__object`s
interface ObjectLiteralTypeNode extends BaseTypeNode {
  type: 'ObjectLiteral';
  name: string; // parent's symbolName
  properties: Record<string, TypeNode>;
}

interface TypeLiteralTypeNode extends BaseTypeNode {
  type: 'TypeLiteral';
  name?: string; // aliasSymbolName
  properties: Record<string, TypeNode>;
  typeArguments?: TypeNode[]; // resolvedTypeArguments
}

interface InterfaceTypeNode extends BaseTypeNode {
  type: 'Interface';
  name: string;
  properties: Record<string, TypeNode>;
  typeArguments?: TypeNode[]; // resolvedTypeArguments
}

interface ClassTypeNode extends BaseTypeNode {
  type: 'Class';
  name: string;
  properties: Record<string, TypeNode>;
  typeArguments?: TypeNode[]; // resolvedTypeArguments
}

interface UnionTypeNode extends BaseTypeNode {
  type: 'Union';
  name?: string;
  types: TypeNode[];
}

interface IntersectionTypeNode extends BaseTypeNode {
  type: 'Intersection';
  name?: string;
  types: TypeNode[];
}

interface ArrayTypeNode extends BaseTypeNode {
  type: 'Array';
  elementType: TypeNode;
}

// aka TypeParameters
interface GenericTypeNode extends BaseTypeNode {
  type: 'Generic';
  name: string;
  // constraint?: TypeNode // TODO: <T extends {...}>
}

// temp export
export type TypeNode =
  | UnhandledTypeNode
  | PrimitiveTypeNode
  | ObjectLiteralTypeNode
  | TypeLiteralTypeNode
  | InterfaceTypeNode
  | ClassTypeNode
  | UnionTypeNode
  | IntersectionTypeNode
  | ArrayTypeNode
  | GenericTypeNode;

const getObjectFlags = (
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
  // @ts-expect-error `getObjectFlags` is internal
): ts.ObjectFlags => ts.getObjectFlags(t);

function isPrimitiveType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
) {
  const primitiveFlags =
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Null |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.BooleanLike;

  return !!(t.flags & primitiveFlags);
}

function getPrimitiveTypeKind(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
) {
  if (t.flags & ts.TypeFlags.Any) {
    return 'any';
  } else if (t.flags & ts.TypeFlags.Unknown) {
    return 'unknown';
  } else if (t.flags & ts.TypeFlags.Undefined) {
    return 'undefined';
  } else if (t.flags & ts.TypeFlags.Null) {
    return 'null';
  } else if (t.flags & ts.TypeFlags.StringLike) {
    return 'string';
  } else if (t.flags & ts.TypeFlags.NumberLike) {
    return 'number';
  } else if (t.flags & ts.TypeFlags.BooleanLike) {
    return 'boolean';
  } else if (t.flags & ts.TypeFlags.BigIntLike) {
    return 'bigint';
  } else if (t.flags & ts.TypeFlags.ESSymbolLike) {
    return 'symbol';
  }
  return undefined;
}

function isObjectLiteralType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
) {
  return (
    !!(t.flags & ts.TypeFlags.Object) &&
    !!(
      getObjectFlags(ts, t) &
      (ts.ObjectFlags.ObjectLiteral | ts.ObjectFlags.Anonymous)
    ) &&
    !!(t.symbol && t.symbol.flags & ts.SymbolFlags.ObjectLiteral)
  );
}

function getObjectLiteralTypeName(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
) {
  const parent = (t.symbol.valueDeclaration || {}).parent as {
    symbol?: ts.Symbol;
  };

  if (parent && parent.symbol) {
    return ts.symbolName(parent.symbol);
  }

  return '[[anonymous object]]';
}

function isTypeLiteralType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
) {
  return (
    !!(t.flags & ts.TypeFlags.Object) &&
    !!(getObjectFlags(ts, t) & ts.ObjectFlags.Anonymous) &&
    !!(t.symbol && t.symbol.flags & ts.SymbolFlags.TypeLiteral)
  );
}

function isInterfaceType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
): t is ts.InterfaceType {
  return (
    !!(t.flags & ts.TypeFlags.Object) &&
    !!(getObjectFlags(ts, t) & ts.ObjectFlags.Interface)
  );
}

function isReferenceType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  checker: ts.TypeChecker,
  t: ts.Type
): t is ts.TypeReference {
  return (
    !!(t.flags & ts.TypeFlags.Object) &&
    !!(getObjectFlags(ts, t) & ts.ObjectFlags.Reference) &&
    // Array's are reference types, we handle them separately
    !(checker as any).isArrayType(t)
  );
}

function isNonPrimitiveUnionType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
) {
  return (
    t.isUnion() &&
    // @ts-expect-error `TypeFlags.NonPrimitiveUnion` is internal
    !!(t.flags & ts.TypeFlags.NonPrimitiveUnion) &&
    // @ts-expect-error `ObjectFlags.PrimitiveUnion` is internal
    !(getObjectFlags(ts, t) & ts.ObjectFlags.PrimitiveUnion)
  );
}

function isPrimitiveLiteralType(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type
): t is LiteralType {
  return isPrimitiveType(ts, t) && !!(t.flags & ts.TypeFlags.Literal);
}

function getLocationOfSymbol(symbol?: ts.Symbol): BaseTypeNode['location'] {
  if (!symbol || !symbol.declarations) {
    return undefined;
  }

  const node = symbol.valueDeclaration || symbol.declarations[0];

  if (!node) {
    return undefined;
  }

  const file = node.getSourceFile();

  if (!file) {
    return undefined;
  }

  return {
    absFilePath: file.fileName,
    pos: file.getLineAndCharacterOfPosition(node.pos),
    end: file.getLineAndCharacterOfPosition(node.end),
  };
}

const resolveProperties = (
  ts: typeof import('typescript/lib/tsserverlibrary'),
  t: ts.Type,
  checker: ts.TypeChecker,
  resolve: (t: ts.Type) => TypeNode
) => {
  return Object.fromEntries(
    checker.getPropertiesOfType(t).map(p => {
      // @ts-expect-error `getTypeOfSymbol` is internal
      const property = checker.getTypeOfSymbol(p) as ts.Type;
      return [ts.symbolName(p), resolve(property)];
    })
  );
};

function resolveTypeToTypeNode(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  type: ts.Type,
  checker: ts.TypeChecker
) {
  return execWithCache<ts.Type, TypeNode>((t: ts.Type, resolve): TypeNode => {
    if (isPrimitiveType(ts, t)) {
      let value;
      if (isPrimitiveLiteralType(ts, t)) {
        if (t.value === undefined) {
          // TODO placeholder strings are not the way
          value = '[[unhandled primitive literal]]';
        } else if (typeof t.value === 'string') {
          value = `'${t.value}'`;
        } else {
          value = `${t.value}`;
        }
      }

      return {
        type: 'Primitive',
        kind: getPrimitiveTypeKind(ts, t),
        value,
        // // @ts-expect-error `ts.IntrinsicType` is internal
        // (t as ts.IntrinsicType).intrinsicName ||
        // `${(t as ts.LiteralType).value}`,
      };
    } else if (isObjectLiteralType(ts, t)) {
      return {
        type: 'ObjectLiteral',
        name: getObjectLiteralTypeName(ts, t),
        location:
          getLocationOfSymbol(t.aliasSymbol) || getLocationOfSymbol(t.symbol),
        properties: resolveProperties(ts, t, checker, resolve),
      };
    } else if (isTypeLiteralType(ts, t)) {
      return {
        type: 'TypeLiteral',
        name: t.aliasSymbol
          ? ts.symbolName(t.aliasSymbol /*|| t.symbol*/)
          : undefined,
        location:
          getLocationOfSymbol(t.aliasSymbol) || getLocationOfSymbol(t.symbol),
        properties: resolveProperties(ts, t, checker, resolve),
        ...(t.aliasTypeArguments && {
          typeArguments: t.aliasTypeArguments.map(resolve),
        }),
      };
    } else if (
      isInterfaceType(ts, t) ||
      (isReferenceType(ts, checker, t) && isInterfaceType(ts, t.target))
    ) {
      return {
        type: 'Interface',
        // TODO: interfaces should have names, right?
        name: ts.symbolName(/*t.aliasSymbol ||*/ t.symbol),
        location:
          getLocationOfSymbol(t.aliasSymbol) || getLocationOfSymbol(t.symbol),
        properties: resolveProperties(ts, t, checker, resolve),
        ...(isReferenceType(ts, checker, t) && {
          typeArguments: checker.getTypeArguments(t).map(resolve),
        }),
      };
    } else if (
      t.isClass() ||
      (isReferenceType(ts, checker, t) && t.target.isClass())
    ) {
      return {
        type: 'Class',
        name: ts.symbolName(t.aliasSymbol || t.symbol),
        location: getLocationOfSymbol(t.symbol),
        properties: resolveProperties(ts, t, checker, resolve),
        ...(isReferenceType(ts, checker, t) && {
          typeArguments: checker.getTypeArguments(t).map(resolve),
        }),
      };
    } else if (t.isUnion()) {
      return {
        type: 'Union',
        name:
          // Only some primitive unions have no symbol (eg, optional properties)
          isNonPrimitiveUnionType(ts, t) || t.aliasSymbol
            ? ts.symbolName(t.aliasSymbol || t.symbol)
            : undefined, // TODO: Can we use anything better?
        location:
          getLocationOfSymbol(t.aliasSymbol) || getLocationOfSymbol(t.symbol),
        types: t.types.map(resolve),
      };
    } else if (t.isIntersection()) {
      return {
        type: 'Intersection',
        name: ts.symbolName(t.aliasSymbol || t.symbol),
        location:
          getLocationOfSymbol(t.aliasSymbol) || getLocationOfSymbol(t.symbol),
        types: t.types.map(resolve),
      };
    } else if ((checker as any).isArrayType(t)) {
      const elementType = (checker as any).getElementTypeOfArrayType(t);
      return {
        type: 'Array',
        elementType: elementType
          ? resolve(elementType)
          : {
              type: 'Primitive',
              kind: 'undefined',
              value: 'undefined',
            },
        location: getLocationOfSymbol(t.aliasSymbol),
      };
    } else if (t.isTypeParameter()) {
      return {
        type: 'Generic',
        name: ts.symbolName(t.aliasSymbol || t.symbol),
      };
    }

    return { type: 'Unhandled' };
  }, type);
}

function getIntrospection(
  {
    absFilePath,
    pos,
    end,
  }: {
    absFilePath: string;
    pos: number;
    end: number;
  },
  ts: typeof import('typescript/lib/tsserverlibrary'),
  projects: Set<ts.server.Project>
) {
  for (const project of projects) {
    // @ts-expect-error private field
    const program = project.program as ts.Program;
    // @ts-expect-error private field
    if (!program || project.dirty) {
      continue;
    }
    const file = program.getSourceFileByPath(
      absFilePath.toLocaleLowerCase() as any
    );

    if (file) {
      const checker = program.getTypeChecker();

      // Find Target Node
      const nodes: ts.Node[] = [];
      let currentNode: ts.Node | null = file;
      while (currentNode) {
        const next: ts.Node = currentNode;
        nodes.push(currentNode);
        currentNode = null;
        for (const child of next.getChildren()) {
          if (child.pos <= pos && child.end >= end) {
            currentNode = child;
            break;
          }
        }
      }

      for (const node of nodes.reverse()) {
        const symbol = checker.getSymbolAtLocation(node);

        // TODO: should show something if we can't find anything
        if (symbol && node !== file) {
          let type = checker.getTypeOfSymbolAtLocation(symbol, node);

          if (
            type.flags & ts.TypeFlags.Any &&
            (type as any).intrinsicName === 'error'
          ) {
            type = checker.getTypeAtLocation(node);

            if (
              type.flags & ts.TypeFlags.Any &&
              (type as any).intrinsicName === 'error'
            ) {
              continue;
            }
          }

          const resolvedTypeNode = resolveTypeToTypeNode(ts, type, checker);
          const serialized = dehydrateValue(resolvedTypeNode);
          return serialized;
        }
      }
    }
  }

  return undefined;
}

function getDecorationRanges(
  { absFilePaths }: { absFilePaths: string[] },
  ts: typeof import('typescript/lib/tsserverlibrary'),
  projects: Set<ts.server.Project>
) {
  try {
    return absFilePaths.map(absFilePath => {
      const anyDecorations: Array<{ pos: number; end: number }> = [];
      for (const project of projects) {
        // @ts-expect-error program is a private field. We need to read program
        // without triggering a rebuild, and there isn't a public API for that.
        // We'll bail early if the project is marked dirty anyway.
        const program: ts.Program = project.program as ts.Program;
        const file = project.getSourceFile(
          absFilePath.toLocaleLowerCase() as ts.Path
        );

        // @ts-expect-error dirty is marked as internal
        if (file && program && !project.dirty) {
          const checker = program.getTypeChecker();
          const stack: Node[] = [file];
          const push = (node: Node) => void stack.push(node);
          while (stack.length) {
            const next = stack.pop()!;
            next.forEachChild(push);
            if (
              // @ts-expect-error typescript's types are wrong
              ts.isExpressionNode(next) &&
              // JSX tag names are identifiers that need special treatment.
              // We don't attempt to handle them
              (next.kind !== ts.SyntaxKind.Identifier ||
                // @ts-expect-error resolveName is marked as internal
                checker.resolveName(
                  (next as ts.Identifier).escapedText,
                  next,
                  // eslint-disable-next-line no-bitwise
                  ts.SymbolFlags.Value | ts.SymbolFlags.ExportValue,
                  false
                ))
            ) {
              const type = checker.getTypeAtLocation(next);
              if (
                // eslint-disable-next-line no-bitwise
                type.flags & ts.TypeFlags.Any &&
                // @ts-expect-error typescript's types are unhelpful
                type.intrinsicName === 'any'
              ) {
                anyDecorations.push({
                  pos: next.pos,
                  end: next.end,
                });
              }
            }
          }
        }
      }
      return {
        absFilePath,
        anyDecorations,
      };
    });
  } catch (err) {
    console.error(err);
  }
  return [];
}
