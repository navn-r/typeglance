export interface FileTree {
  [path: string]: string | FileTree;
}

const fixturePositions = new Map<unknown, [number, number]>();

export function fixturePosition(token: unknown): [number, number] {
  const position = fixturePositions.get(token);
  if (!position) {
    throw new Error('unknown token');
  }
  return position;
}

export function fixtureDocument(
  documentContents: TemplateStringsArray,
  ...interpolations: unknown[]
) {
  let fullContent = '';

  for (let i = 0; i < interpolations.length; i++) {
    fullContent += documentContents[i];

    const precedingLines = fullContent.split('\n');

    fixturePositions.set(interpolations[i], [
      precedingLines.length - 1,
      precedingLines.pop()!.length,
    ]);
  }

  fullContent += documentContents[documentContents.length - 1];

  return fullContent;
}
