import { handlerKey } from './handlers';
import type { TypeNode } from '../language-server-plugin';
import { Dehydrated } from './hydration';

export function getVscodeExtensionHostEnv(): string {
  return `${process.pid}`;
}

export const dynamicImport =
  typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;

export const getTypeScriptDecorations = handlerKey<
  {
    absFilePaths: string[];
  },
  Array<{
    absFilePath: string;
    anyDecorations: Array<{
      pos: number;
      end: number;
    }>;
  }>
>('get-typescript-decorations');

export const getTypeScriptIntrospection = handlerKey<
  {
    absFilePath: string;
    pos: number;
    end: number;
  },
  Dehydrated<TypeNode> | undefined
>('get-typescript-introspection');
